"""API の入口。API Gateway から呼ばれ、「どの道（ルート）か」で処理を分ける。

ログインの確認は API Gateway が済ませている。ここではトークンの中身（claims）から
ユーザーID（sub）を取り出し、必ずその人のデータだけを読み書きする。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from .db import Invalid, NotFound, Repo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_repo: Repo | None = None


def repo() -> Repo:
    # Lambda は同じ箱を使い回すので、DB への接続の準備は1回だけにする
    global _repo
    if _repo is None:
        _repo = Repo()
    return _repo


def _json(status: int, body: Any) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def _error(status: int, code: str, message: str) -> dict:
    return _json(status, {"error": {"code": code, "message": message}})


def _claims(event: dict) -> dict:
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})


def _body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise Invalid("送られてきたデータの形がおかしいです") from e
    if not isinstance(data, dict):
        raise Invalid("送られてきたデータの形がおかしいです")
    return data


# ───────── それぞれの道の処理 ─────────
def get_me(user_id: str, event: dict) -> dict:
    return _json(200, repo().get_or_create_profile(user_id, _claims(event).get("email")))


def list_projects(user_id: str, event: dict) -> dict:
    return _json(200, {"projects": repo().list_projects(user_id)})


def create_project(user_id: str, event: dict) -> dict:
    return _json(201, repo().create_project(user_id, str(_body(event).get("title", ""))))


def get_project(user_id: str, event: dict) -> dict:
    return _json(200, repo().get_project(user_id, event["pathParameters"]["projectId"]))


def delete_project(user_id: str, event: dict) -> dict:
    repo().delete_project(user_id, event["pathParameters"]["projectId"])
    return {"statusCode": 204, "body": ""}


ROUTES: dict[str, Callable[[str, dict], dict]] = {
    "GET /me": get_me,
    "GET /projects": list_projects,
    "POST /projects": create_project,
    "GET /projects/{projectId}": get_project,
    "DELETE /projects/{projectId}": delete_project,
}


def handler(event: dict, context: Any) -> dict:
    route = event.get("routeKey", "")
    fn = ROUTES.get(route)
    if fn is None:
        return _error(404, "NOT_FOUND", "そのAPIはありません")

    user_id = _claims(event).get("sub")
    if not user_id:
        # API Gateway で止まるはずだが、念のため（設定ミスでログインなしになっても漏れない）
        return _error(401, "UNAUTHORIZED", "ログインしてください")

    try:
        return fn(user_id, event)
    except Invalid as e:
        return _error(400, "INVALID", str(e))
    except NotFound:
        return _error(404, "NOT_FOUND", "見つかりませんでした")
    except Exception:
        # 中身（個人情報やキー）をログに出さないよう、どの道で失敗したかだけ残す
        logger.exception("unexpected error on %s", route)
        return _error(500, "INTERNAL", "うまくいきませんでした。少し待ってからもう一度ためしてください")
