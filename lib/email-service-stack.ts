import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSource from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';

export class EmailServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // create the SQS queue
    const orderQueue = new sqs.Queue(this, 'OrderProcessingQueue', {
      visibilityTimeout: Duration.seconds(45),
      queueName: 'order-processing-queue',
    });

    // create an sqs event source
    const lambdaSqsEventSource = new lambdaEventSource.SqsEventSource(orderQueue, {
      batchSize: 10,
      enabled: true,
    });

    // create the lambda responsible for processing orders
    const processOrderFunction = new lambda.Function(this, 'ProcessOrderLambda', {
      code: lambda.Code.fromAsset('lambda'),
      handler: 'lambdas.processOrder',
      runtime: lambda.Runtime.NODEJS_16_X,
    });

    // attach the event source to the orderProcessing lambda, so that Lambda can poll the queue and invoke the OrderProcessing Lambda
    processOrderFunction.addEventSource(lambdaSqsEventSource);
    // grant the order process lambda permission to invoke SES
    processOrderFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendRawEmail', 'ses:SendTemplatedEmail', 'ses:SendEmail'],
      resources: ['*'],
      sid: 'SendEmailPolicySid',
    }));

    // provision the DynamoDB order table
    const orderTable = new dynamodb.Table(this, 'OrderTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.DEFAULT,
      pointInTimeRecovery: false,
    });

    // creates the Lambda function to create the order.
    const createOrderFunction = new lambda.Function(this, 'CreateOrderLambda', {
      code: lambda.Code.fromAsset('lambda'),
      handler: 'lambdas.createOrder',
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        ORDER_TABLE_NAME: orderTable.tableName,
        ORDER_PROCESSING_QUEUE_URL: orderQueue.queueUrl,
        ADMIN_EMAIL: 'lakindu2002@live.com'
      }
    });
    orderTable.grantWriteData(createOrderFunction); // allow the createOrder lambda function to write to the order table
    orderQueue.grantSendMessages(createOrderFunction); // allow the createOrder lambda function to send messages to the order processing queue

    // creates an API Gateway REST API
    const restApi = new apigateway.RestApi(this, 'EmailServiceApi', {
      restApiName: 'EmailService',
    });

    // create an api gateway resource '/orders/new'
    const newOrders = restApi.root.addResource('orders').addResource('new');
    // creating a POST method for the new order resource that integrates with the createOrder Lambda function
    newOrders.addMethod('POST', new apigateway.LambdaIntegration(createOrderFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });
  }
}
