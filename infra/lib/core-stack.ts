// MVスタジオの土台：登録・ログイン（Cognito）・DB（DynamoDB）・ファイル置き場（S3）・API。
// 制作のワークフロー（Step Functions）は Phase 4 で足す。
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { pipelineCode } from "./python-code.js";

/** 画面からAPIを呼んでよい場所（Phase 1b で Vercel のURLを足す） */
export const ALLOWED_ORIGINS = ["http://localhost:3000"];

export class CoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ───────── 登録・ログイン（Cognito） ─────────
    // 一般公開なので、誰でも自分で登録できる（申告ノートとのいちばんの違い）。
    // 登録するとメールに確認コードが届き、入力するまでログインできない
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "mv-studio-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailSubject: "【MVスタジオ】確認コード",
        emailBody: "MVスタジオへの登録ありがとうございます。確認コードは {####} です。",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // 消しても利用者は残す（事故防止）。ただし「最初に作るときに失敗した」ときは残さない
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // 画面（ブラウザ）用の入口。ブラウザには秘密を置けないので secret なし
    const userPoolClient = userPool.addClient("WebClient", {
      generateSecret: false,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      // 「このメールは登録されていません」と答えない（登録済みのメールを他人に調べられないように）
      preventUserExistenceErrors: true,
    });

    // ───────── DB（DynamoDB・1つの表にまとめる形） ─────────
    // PK（グループの名前）と SK（グループの中の並び）で1行を決める。設計書の5章
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(), // 使った分だけ払う。使わなければほぼ0円
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // 35日以内の好きな時点に戻せる
      timeToLiveAttribute: "expiresAt", // この時刻を過ぎた行は自動で消える（一時的なデータ用）
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // ───────── ファイル置き場（曲・画像・動画） ─────────
    const bucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // 外から絶対に見えない（見せるときは期限つきURL）
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // ブラウザから期限つきURLで直接アップロード・ダウンロードするための許可
      cors: [
        {
          allowedOrigins: ALLOWED_ORIGINS,
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ["content-type"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        // 途中で止まったアップロードのかけらは1日で消す
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // 曲・途中の画像・動画は30日で自動で消す（保存期間。利用規約にも書く）
        { prefix: "projects/", expiration: Duration.days(30) },
      ],
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // ───────── API（API Gateway + Lambda） ─────────
    const apiFn = new lambda.Function(this, "ApiFunction", {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64, // 安くて速い
      code: pipelineCode(),
      handler: "mvstudio.handler.handler",
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName, MEDIA_BUCKET: bucket.bucketName },
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(apiFn);

    // ログインしている人だけ通す（Cognito のトークンを API Gateway が確かめる）
    const authorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });
    const httpApi = new apigw.HttpApi(this, "HttpApi", {
      apiName: "mv-studio-api",
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.hours(1),
      },
    });
    // 公開サービスなので、呼ばれすぎないように速さの上限をつける（いたずら・バグ対策）
    const stage = httpApi.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };

    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    const routes: [string, apigw.HttpMethod][] = [
      ["/me", apigw.HttpMethod.GET],
      ["/projects", apigw.HttpMethod.GET],
      ["/projects", apigw.HttpMethod.POST],
      ["/projects/{projectId}", apigw.HttpMethod.GET],
      ["/projects/{projectId}", apigw.HttpMethod.DELETE],
    ];
    for (const [path, method] of routes) {
      httpApi.addRoutes({ path, methods: [method], integration, authorizer });
    }

    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "MediaBucketName", { value: bucket.bucketName });
  }
}
