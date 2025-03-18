## Enterprise Web Development module - Serverless REST Assignment.

__Name:__ Martin Walsh

__Demo:__ https://www.youtube.com/watch?v=ZcYaq3EdJCw

### Overview.

This repository contains a serverless REST API for Movie Reviews implemented using AWS CDK and Lambda functions. The API allows users to add, retrieve, update, and translate movie reviews, with authentication and authorization mechanisms in place.

### App API endpoints.

+ GET /movies/all-reviews - Get all movie reviews. Supports optional query parameter for filtering by reviewerId.

+ GET /movies/{movieId}/reviews - Get all reviews for a specific movie. Supports optional query parameter for filtering by reviewerId.

+ POST /movies/{movieId}/reviews - Add a new movie review. Requires authentication.

+ PUT /movies/{movieId}/reviews/{reviewId} - Update an existing movie review. Requires authentication and authorization (only the review owner can update).

+ GET /movies/{movieId}/reviews/{reviewId}/translate/{language} - Translate a specific movie review to the specified language.

### Features.

#### Translation persistence

The translation persistence is implemented in the `translateMovieReview.ts` Lambda function. When a translation is requested, the function checks if a cached translation exists and is still valid (based on a TTL). If not, it performs a new translation and stores it in the DynamoDB table.

The structure of a table item that includes review translations:

+ MovieId (Partition key) - Number
+ ReviewId (Sort key) - Number
+ ReviewerId - String (reviewer email address)
+ ReviewDate - String
+ Content - String (the review text)
+ Translations - Map
  - [language code]: Object
    - content: String (translated text)
    - lastUpdated: String (ISO date)
    - ttl: Number (expiration timestamp)

#### Custom L2 Construct

[Not implemented yet]

#### Restricted review updates

The restricted review updates feature is implemented in the `updateMovieReview.ts` Lambda function. Before allowing an update, the function:

1. Verifies the user's authentication token.
2. Retrieves the existing review from DynamoDB.
3. Compares the reviewerId of the existing review with the reviewerId in the update request.
4. Only allows the update if the reviewerId matches, ensuring that only the original author can modify the review.

This approach ensures that users can only update their own reviews, maintaining data integrity and user ownership of content.

#### API Gateway validators. (if completed)

[Not implemented yet]


