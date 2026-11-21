"""DynamoDB の読み書き。設計書の5章の「1つの表」の形をここにまとめる。

キーの組み立てをこのファイルだけで行い、ほかの場所では PK・SK の文字列を直接書かない。
（書き方がばらばらになると、取りたいデータが取れないバグになりやすいため）
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

TITLE_MAX = 80


class NotFound(Exception):
    """見つからない。他人のデータのときも、あることを教えないためにこれを使う。"""


class Invalid(Exception):
    """入力がおかしい。"""


# ───────── キーの組み立て ─────────
def user_pk(user_id: str) -> str:
    return f"USER#{user_id}"


def project_pk(project_id: str) -> str:
    return f"PROJECT#{project_id}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Repo:
    """1つの表への読み書きをまとめたもの。テストでは本物のかわりに moto（にせのAWS）の表を渡す。"""

    def __init__(self, table: Any | None = None) -> None:
        self.table = table or boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])

    # ───────── ユーザー ─────────
    def get_or_create_profile(self, user_id: str, email: str | None) -> dict:
        """はじめてAPIを呼んだときにユーザーの情報を作る。2回目からは読むだけ。"""
        key = {"PK": user_pk(user_id), "SK": "PROFILE"}
        item = {**key, "email": email or "", "plan": "free", "createdAt": now_iso()}
        try:
            # 「まだない場合だけ書く」（条件つき書き込み）。同時に2回呼ばれても上書きしない
            self.table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
            return _profile(item)
        except self.table.meta.client.exceptions.ConditionalCheckFailedException:
            return _profile(self.table.get_item(Key=key)["Item"])

    # ───────── MV（プロジェクト） ─────────
    def create_project(self, user_id: str, title: str) -> dict:
        title = (title or "").strip()
        if not title:
            raise Invalid("タイトルを入れてください")
        if len(title) > TITLE_MAX:
            raise Invalid(f"タイトルは{TITLE_MAX}文字までです")

        project_id = uuid.uuid4().hex
        created_at = now_iso()
        # 一覧用の行。SK に作成日時を入れておくと、新しい順に並べて取れる
        list_item = {
            "PK": user_pk(user_id),
            "SK": f"PROJECT#{created_at}#{project_id}",
            "projectId": project_id,
            "title": title,
            "status": "draft",
            "createdAt": created_at,
        }
        # MV本体の見出し行。持ち主を書いておき、読むたびに確かめる
        meta_item = {
            "PK": project_pk(project_id),
            "SK": "META",
            "projectId": project_id,
            "ownerId": user_id,
            "listSk": list_item["SK"],
            "title": title,
            "status": "draft",
            "createdAt": created_at,
        }
        # 2行を「両方書くか、両方書かないか」で書く（トランザクション）。片方だけ残るのを防ぐ
        client = self.table.meta.client
        client.transact_write_items(
            TransactItems=[
                {"Put": {"TableName": self.table.name, "Item": list_item}},
                {
                    "Put": {
                        "TableName": self.table.name,
                        "Item": meta_item,
                        "ConditionExpression": "attribute_not_exists(PK)",
                    }
                },
            ]
        )
        return _project(meta_item)

    def list_projects(self, user_id: str) -> list[dict]:
        """自分のMVを新しい順に。PK が自分・SK が PROJECT# で始まる行を1回で取る。"""
        resp = self.table.query(
            KeyConditionExpression=Key("PK").eq(user_pk(user_id)) & Key("SK").begins_with("PROJECT#"),
            ScanIndexForward=False,  # 新しい順
        )
        return [_project(i) for i in resp["Items"]]

    def _get_meta(self, user_id: str, project_id: str) -> dict:
        item = self.table.get_item(Key={"PK": project_pk(project_id), "SK": "META"}).get("Item")
        # 他人のMVでも「見つからない」と返す（あることを教えない）
        if not item or item["ownerId"] != user_id:
            raise NotFound()
        return item

    def get_project(self, user_id: str, project_id: str) -> dict:
        return _project(self._get_meta(user_id, project_id))

    def delete_project(self, user_id: str, project_id: str) -> None:
        """MVと、その中のデータ（曲・シーンなど）を全部消す。"""
        meta = self._get_meta(user_id, project_id)
        keys = [{"PK": user_pk(user_id), "SK": meta["listSk"]}]
        query = {"KeyConditionExpression": Key("PK").eq(project_pk(project_id)), "ProjectionExpression": "PK, SK"}
        while True:
            resp = self.table.query(**query)
            keys += [{"PK": i["PK"], "SK": i["SK"]} for i in resp["Items"]]
            if "LastEvaluatedKey" not in resp:
                break
            query["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        # まとめて消す（25行ずつ送る作業は batch_writer がやってくれる）
        with self.table.batch_writer() as batch:
            for key in keys:
                batch.delete_item(Key=key)


# ───────── 画面に返す形 ─────────
def _profile(item: dict) -> dict:
    return {"email": item.get("email", ""), "plan": item.get("plan", "free"), "createdAt": item["createdAt"]}


def _project(item: dict) -> dict:
    return {
        "projectId": item["projectId"],
        "title": item["title"],
        "status": item["status"],
        "createdAt": item["createdAt"],
    }
