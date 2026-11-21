// CDK の入口。どのスタック（AWSの部品のまとまり）を作るかを並べる。
import { App, Tags } from "aws-cdk-lib";
import { CoreStack } from "../lib/core-stack.js";
import { GithubOidcStack } from "../lib/github-oidc-stack.js";

const app = new App();

// アカウント番号はコードに書かず、そのとき使っている認証情報から自動で入る
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "ap-southeast-2", // シドニー（このアカウントは東京を使えない）
};

new GithubOidcStack(app, "MvStudioGithubOidc", {
  env,
  subjectPrefix: "repo:lunamoon-00@204539346/mv-studio@1466272088",
  description: "MVスタジオ: GitHub Actions から AWS に入るための設定",
});

new CoreStack(app, "MvStudio", {
  env,
  description: "MVスタジオ: 登録・ログイン・DB・ファイル置き場・API",
});

// 全部の部品に「どのプロジェクトのものか」の札をつける（料金の内訳で見分けられる）
Tags.of(app).add("project", "mv-studio");
