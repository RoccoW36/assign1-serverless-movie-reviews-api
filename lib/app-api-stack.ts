import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as custom from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { generateBatch } from "../shared/util";
import { movieReviews } from "../seed/movieReviews";
import * as apig from "aws-cdk-lib/aws-apigateway";
import * as path from "path";

export class AppAPIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Movie Reviews Table
    const movieReviewsTable = new dynamodb.Table(this, "MovieReviewsTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "movieId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "reviewId", type: dynamodb.AttributeType.NUMBER },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "MovieReviews",
    });

    // Global Secondary Index
    movieReviewsTable.addGlobalSecondaryIndex({
      indexName: "ReviewerIndex",
      partitionKey: { name: "reviewerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "reviewDate", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Seed Data
    new custom.AwsCustomResource(this, "reviewsddbInitData", {
      onCreate: {
        service: "DynamoDB",
        action: "batchWriteItem",
        parameters: {
          RequestItems: {
            [movieReviewsTable.tableName]: generateBatch(movieReviews),
          },
        },
        physicalResourceId: custom.PhysicalResourceId.of("reviewsddbInitData"),
      },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [movieReviewsTable.tableArn],
      }),
    });

    // Helper function to create Lambda functions
    const createLambda = (id: string, entry: string, additionalEnv?: Record<string, string>) =>
      new lambdanode.NodejsFunction(this, id, {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_18_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        environment: {
          TABLE_NAME: movieReviewsTable.tableName,
          REGION: "eu-west-1",
          ...additionalEnv,
        },
        entry,
      });

    // Define Lambda functions
    const getMovieReviewByIdFn = createLambda("getMovieReviewByIdFn", path.join(__dirname, "../lambdas/getMovieReviewById.ts"));
    const getAllMovieReviewsFn = createLambda("getAllMovieReviewsFn", path.join(__dirname, "../lambdas/getAllMovieReviews.ts"), {
      GSI_REVIEWER_INDEX: "ReviewerIndex",
    });
    const addMovieReviewFn = createLambda("AddMovieReviewFn", path.join(__dirname, "../lambdas/addMovieReview.ts"));
    const updateMovieReviewFn = createLambda("UpdateMovieReviewFn", path.join(__dirname, "../lambdas/updateMovieReview.ts"));
    const translateMovieReviewFn = createLambda("TranslateMovieReviewFn", path.join(__dirname, "../lambdas/translateMovieReview.ts"));
    

    // Grant permissions
    movieReviewsTable.grantReadData(getMovieReviewByIdFn);
    movieReviewsTable.grantReadData(getAllMovieReviewsFn);
    movieReviewsTable.grantReadWriteData(addMovieReviewFn);
    movieReviewsTable.grantReadWriteData(updateMovieReviewFn);
    movieReviewsTable.grantReadWriteData(translateMovieReviewFn);

    translateMovieReviewFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["translate:TranslateText"],
        resources: ["*"],
      })
    );

    // REST API Setup
    const api = new apig.RestApi(this, "RestAPI", {
      description: "Movie API",
      deployOptions: {
        stageName: "dev",
      },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date"],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    // Define API Resources
    const movieReviewsEndpoint = api.root.addResource("movies");
    const specificMovieEndpoint = movieReviewsEndpoint.addResource("{movieId}");
    const movieReviewsByMovieId = specificMovieEndpoint.addResource("reviews");
    const reviewResource = movieReviewsByMovieId.addResource("{reviewId}");
    const translateReviewResource = reviewResource.addResource("translate").addResource("{language}");

    // API Gateway Methods
    const allReviewsResource = movieReviewsEndpoint.addResource("all-reviews");
    allReviewsResource.addMethod("GET", new apig.LambdaIntegration(getAllMovieReviewsFn, { proxy: true }));
    movieReviewsByMovieId.addMethod("GET", new apig.LambdaIntegration(getMovieReviewByIdFn, { proxy: true }));
    movieReviewsByMovieId.addMethod("POST", new apig.LambdaIntegration(addMovieReviewFn, { proxy: true }));
    reviewResource.addMethod("PUT", new apig.LambdaIntegration(updateMovieReviewFn, { proxy: true }));
    translateReviewResource.addMethod("GET", new apig.LambdaIntegration(translateMovieReviewFn, { proxy: true }));
  }
}
