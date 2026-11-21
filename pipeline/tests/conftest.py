"""テストの準備。moto（にせのAWS）で、本物と同じ形の DynamoDB の表を作る。"""

import os

import boto3
import pytest
from moto import mock_aws

# 本物の AWS に絶対につながらないよう、にせの設定を入れておく
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-southeast-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ["TABLE_NAME"] = "mv-studio-test"


@pytest.fixture
def table():
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        t = ddb.create_table(
            TableName=os.environ["TABLE_NAME"],
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield t


@pytest.fixture
def repo(table):
    from mvstudio.db import Repo

    return Repo(table)


@pytest.fixture
def call(table, monkeypatch):
    """API を呼ぶまねをする。call("POST /projects", user="u1", body={...})"""
    import json

    from mvstudio import handler as h
    from mvstudio.db import Repo

    monkeypatch.setattr(h, "_repo", Repo(table))

    def _call(route, user="user-a", body=None, path=None, email="a@example.com"):
        claims = {"sub": user, "email": email} if user else {}
        event = {
            "routeKey": route,
            "requestContext": {"authorizer": {"jwt": {"claims": claims}}},
            "pathParameters": path or {},
            "body": json.dumps(body) if body is not None else None,
        }
        res = h.handler(event, None)
        data = json.loads(res["body"]) if res.get("body") else None
        return res["statusCode"], data

    return _call
