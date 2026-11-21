// GitHub Actions から「鍵なし」で AWS に入るための設定。
// 最初の1回だけ手元から反映する（このあとの公開は GitHub Actions がやる）。
import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface GithubOidcStackProps extends StackProps {
  /**
   * GitHub の身分証（トークン）に書かれるリポジトリの名前（「名前＠番号」の形）。
   * 確認方法: gh api repos/<owner>/<repo>/actions/oidc/customization/sub の sub_claim_prefix
   */
  subjectPrefix: string;
}

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    // ① 「GitHub の身分証を信用する」登録は、アカウントに1つしか作れない。
    //    申告ノートですでに作ってあるので、新しく作らずに名前（ARN）で借りてくる
    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GithubProvider",
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    // ② GitHub Actions が借りる役割（ロール）。
    //    「mv-studio リポジトリの main ブランチから来たときだけ」借りられるように絞る
    const deployRole = new iam.Role(this, "DeployRole", {
      roleName: "mv-studio-github-deploy",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `${props.subjectPrefix}:ref:refs/heads/main`,
        },
      }),
    });

    // ③ このロール自身には強い権限を持たせない。
    //    CDK が最初に作った「反映用のロール（cdk-xxx）」を借りることだけ許す
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", {
      value: deployRole.roleArn,
      description: "GitHub の Variables に AWS_DEPLOY_ROLE_ARN として登録する",
    });
  }
}
