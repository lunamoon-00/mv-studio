# MVスタジオ（仮）

Suno で作った曲から、**キャラの見た目がそろった AI MV** を作る Web サービス（制作中）。

- 絵コンテ → キャラシート → シーン画像 → 見た目チェックと自動作り直し → 動画 → ビートに合わせた編集 → 横長MV・縦型ショート
- 画像：Seedream ／ 動画：Seedance・MiniMax ／ チェック・絵コンテ：Gemini
- 構成：Next.js（Vercel）＋ AWS（Cognito・API Gateway・Lambda・Step Functions・DynamoDB・S3・Fargate・KMS、CDK で管理）

設計書：[docs/design.md](docs/design.md)

## 進み具合

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 料金・規約の確認、リポジトリ、予算アラート | 進行中 |
| 1 | 土台（登録・ログイン・DB・API・公開） | |
| 2 | 曲の分析・絵コンテ | |
| 3 | AIの窓口・APIキー・キャラシート | |
| 4 | シーン画像の並列生成・見た目チェック | |
| 5 | 画像→動画 | |
| 6 | 編集・書き出し | |
| 7 | 公開の準備・成果 | |
