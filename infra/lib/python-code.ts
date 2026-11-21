// Lambda（Python）に載せるコード。
// 今は boto3（AWSを操作するライブラリ）しか使わず、それは Lambda に最初から入っているので、
// pipeline/ の mvstudio フォルダをそのまま載せるだけでよい（pip install のまとめ作業がいらない）。
import * as lambda from "aws-cdk-lib/aws-lambda";
import { fileURLToPath } from "node:url";

export const PIPELINE_DIR = fileURLToPath(new URL("../../pipeline", import.meta.url));

export function pipelineCode(): lambda.Code {
  return lambda.Code.fromAsset(PIPELINE_DIR, {
    // これらは Lambda に載せない（テストや手元の作業用）
    exclude: [".venv", "tests", "**/__pycache__", ".pytest_cache", "requirements*.txt", "pyproject.toml"],
  });
}
