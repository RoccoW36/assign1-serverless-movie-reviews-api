import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as custom from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { generateBatch } from "../shared/util";
import { movieReviews } from "../seed/movieReviews";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as path from "path";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { AppApiProps } from "../shared/types";
import { MovieReviewsTable } from "./movie-reviews-table";

export class AppAPI extends Construct {
  constructor(scope: Construct, id: string, props: AppApiProps) {
    super(scope, id);

    // Common Lambda properties
    const appCommonFnProps = {
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        USER_POOL_ID: props.userPoolId,
        CLIENT_ID: props.userPoolClientId,
        REGION: cdk.Aws.REGION,
      },
    };

    // Create DynamoDB Table using custom construct
    const movieReviewsTable = new MovieReviewsTable(this, "MovieReviewsTable", {
      tableName: "MovieReviews",
    });

    // Seed Data using custom resource
    new custom.AwsCustomResource(this, "reviewsddbInitData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [movieReviewsTable.table.tableName]: generateBatch(movieReviews),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [movieReviewsTable.table.tableArn],
      }),
    });

    // Create Lambda Authorizer
    const authorizerFn =  new lambdanode.NodejsFunction(this, "AuthorizerFn", {
      ...appCommonFnProps,
      entry: "./lambdas/auth/authorizer.ts",
    });

    const requestAuthorizer = new apig.RequestAuthorizer(
      this, "RequestAuthorizer", 
      {
      identitySources: [apig.IdentitySource.header("cookie")],
      handler: authorizerFn,
      resultsCacheTtl: cdk.Duration.minutes(0),
    }
  );

    // Update environment variables for Lambda functions
    const lambdaEnvironment = {
      ...appCommonFnProps.environment,
      TABLE_NAME: movieReviewsTable.table.tableName,
    };

    // Define Lambda functions
    const getAllMovieReviewsFn = this.createLambda("getAllMovieReviewsFn", "../lambdas/getAllMovieReviews.ts", {
      ...lambdaEnvironment,
      GSI_REVIEWER_INDEX: "ReviewerIndex",

    });
    const getMovieReviewByIdFn = this.createLambda("getMovieReviewByIdFn", "../lambdas/getMovieReviewById.ts", lambdaEnvironment);
    const addMovieReviewFn = this.createLambda("AddMovieReviewFn", "../lambdas/addMovieReview.ts", lambdaEnvironment);
    const updateMovieReviewFn = this.createLambda("UpdateMovieReviewFn", "../lambdas/updateMovieReview.ts", lambdaEnvironment);
    const translateMovieReviewFn = this.createLambda("TranslateMovieReviewFn", "../lambdas/translateMovieReview.ts", lambdaEnvironment);

    // Grant permissions
    movieReviewsTable.table.grantReadData(getAllMovieReviewsFn);
    movieReviewsTable.table.grantReadData(getMovieReviewByIdFn);
    movieReviewsTable.table.grantReadWriteData(addMovieReviewFn);
    movieReviewsTable.table.grantReadWriteData(updateMovieReviewFn);
    movieReviewsTable.table.grantReadWriteData(translateMovieReviewFn);

    translateMovieReviewFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["translate:TranslateText"],
        resources: ["*"],
      })
    );

   // Create API Gateway
   const appApi = new apig.RestApi(this, "MovieReviewsAPI", {
    description: "Movie Reviews Api",
    deployOptions: { 
      stageName: "dev" 
    },
    endpointTypes: [apig.EndpointType.REGIONAL],
    defaultCorsPreflightOptions: {
      allowOrigins: apig.Cors.ALL_ORIGINS,
    },
  });

    // Define API Resources
    const movieReviewsEndpoint = appApi.root.addResource("movies");
    const specificMovieEndpoint = movieReviewsEndpoint.addResource("{movieId}");
    const movieReviewsByMovieId = specificMovieEndpoint.addResource("reviews");
    const reviewResource = movieReviewsByMovieId.addResource("{reviewId}");
    const translateReviewResource = reviewResource.addResource("translate").addResource("{language}");

    // API Gateway Methods
    const allReviewsResource = movieReviewsEndpoint.addResource("all-reviews");
    allReviewsResource.addMethod("GET", new apig.LambdaIntegration(getAllMovieReviewsFn, { proxy: true }));
    movieReviewsByMovieId.addMethod("GET", new apig.LambdaIntegration(getMovieReviewByIdFn, { proxy: true }));
    translateReviewResource.addMethod("GET", new apig.LambdaIntegration(translateMovieReviewFn, { proxy: true }));
    movieReviewsByMovieId.addMethod("POST", new apig.LambdaIntegration(addMovieReviewFn, { proxy: true }), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,  
    });

    reviewResource.addMethod("PUT", new apig.LambdaIntegration(updateMovieReviewFn, { proxy: true }), {
      authorizer: requestAuthorizer,
      authorizationType: apig.AuthorizationType.CUSTOM,  
    });

    }

    private createLambda(id: string, entry: string, environment: Record<string, string>) {
      return new lambdanode.NodejsFunction(this, id, {
        entry: path.join(__dirname, entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 128,
        timeout: cdk.Duration.seconds(10),
        environment,
      });
    }
  }