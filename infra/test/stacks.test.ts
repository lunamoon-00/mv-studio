// CDK のテスト：「作られる設定」が、決めたルールどおりかを確かめる。
// AWS には何も作らずに、手元で設定の中身（テンプレート）だけを調べる。
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CoreStack } from "../lib/core-stack.js";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

const env = { account: "123456789012", region: "ap-southeast-2" };

describe("土台スタック", () => {
  const template = Template.fromStack(new CoreStack(new App(), "Test", { env }));

  it("誰でも登録でき、メールの確認コードで本人確認する", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      AutoVerifiedAttributes: ["email"],
      UsernameAttributes: ["email"],
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
    });
  });

  it("登録済みのメールかどうかを他人に教えない", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      PreventUserExistenceErrors: "ENABLED",
      GenerateSecret: false,
    });
  });

  it("DB は PK と SK の1つの表で、使った分だけ払う形・好きな時点に戻せる", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  it("ファイル置き場は外から見えず、制作データは30日で消える", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ Prefix: "projects/", ExpirationInDays: 30 })]),
      },
    });
  });

  it("API はすべてログインが必要（Cognito のトークンを確かめる）", () => {
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route"));
    expect(routes.length).toBe(5);
    for (const route of routes) {
      expect([route.Properties.RouteKey, route.Properties.AuthorizationType]).toEqual([
        route.Properties.RouteKey,
        "JWT",
      ]);
    }
  });

  it("API は呼ばれすぎないように速さの上限がある", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
  });

  it("Lambda は Python 3.13・arm64 で、ログは1か月で消える", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.13",
      Architectures: ["arm64"],
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });
});

describe("GitHub OIDC スタック", () => {
  const template = Template.fromStack(
    new GithubOidcStack(new App(), "TestOidc", { env, subjectPrefix: "repo:owner@1/repo@2" }),
  );

  it("アカウントに1つの OIDC の登録は新しく作らない（申告ノートのものを借りる）", () => {
    template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  });

  it("main ブランチからだけロールを借りられる", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": "repo:owner@1/repo@2:ref:refs/heads/main",
              },
            },
          }),
        ],
      },
    });
  });
});
