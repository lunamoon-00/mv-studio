"""API のテスト。とくに「他人のデータが見えない・消せない」ことを確かめる。"""

import time


def test_はじめてのユーザーは情報が作られ2回目は同じものが返る(call):
    status, me = call("GET /me")
    assert status == 200
    assert me["plan"] == "free"
    assert me["email"] == "a@example.com"

    status, again = call("GET /me")
    assert again["createdAt"] == me["createdAt"]


def test_MVを作ると一覧に新しい順で出る(call):
    call("POST /projects", body={"title": "1曲目"})
    time.sleep(1.1)  # 作成日時（秒まで）をずらす
    call("POST /projects", body={"title": "2曲目"})

    status, data = call("GET /projects")
    assert status == 200
    assert [p["title"] for p in data["projects"]] == ["2曲目", "1曲目"]


def test_タイトルの前後の空白は消える(call):
    status, p = call("POST /projects", body={"title": "  夜のうた  "})
    assert status == 201
    assert p["title"] == "夜のうた"
    assert p["status"] == "draft"


def test_タイトルが空や長すぎるとエラー(call):
    assert call("POST /projects", body={"title": "   "})[0] == 400
    assert call("POST /projects", body={"title": "あ" * 81})[0] == 400
    assert call("POST /projects", body={"title": "あ" * 80})[0] == 201


def test_形のおかしいデータはエラー(call, table, monkeypatch):
    from mvstudio import handler as h

    event = {
        "routeKey": "POST /projects",
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "user-a"}}}},
        "body": "{これはJSONじゃない",
    }
    assert h.handler(event, None)["statusCode"] == 400


def test_他人のMVは一覧に出ず_読めず_消せない(call):
    _, mine = call("POST /projects", user="user-a", body={"title": "Aさんの曲"})
    pid = mine["projectId"]

    # Bさんの一覧には出ない
    assert call("GET /projects", user="user-b")[1]["projects"] == []
    # Bさんが直接IDを指定しても「見つからない」（あることも教えない）
    assert call("GET /projects/{projectId}", user="user-b", path={"projectId": pid})[0] == 404
    assert call("DELETE /projects/{projectId}", user="user-b", path={"projectId": pid})[0] == 404
    # Aさんのものは残っている
    assert call("GET /projects/{projectId}", user="user-a", path={"projectId": pid})[0] == 200


def test_MVを消すと中のデータも一覧からも消える(call, table):
    _, p = call("POST /projects", body={"title": "消す曲"})
    pid = p["projectId"]
    # Phase 2 以降で入る「中のデータ」のかわりに、シーンの行を置いておく
    table.put_item(Item={"PK": f"PROJECT#{pid}", "SK": "SCENE#001", "prompt": "x"})

    assert call("DELETE /projects/{projectId}", path={"projectId": pid})[0] == 204
    assert call("GET /projects")[1]["projects"] == []
    # 表の中に、このMVに関係する行（一覧の行・見出し・シーン）が1つも残っていない
    left = [i for i in table.scan()["Items"] if pid in i["PK"] or pid in i["SK"]]
    assert left == []
    assert call("GET /projects/{projectId}", path={"projectId": pid})[0] == 404


def test_ログイン情報がないと401(call):
    assert call("GET /projects", user=None)[0] == 401


def test_ない道は404(call):
    assert call("GET /nothing")[0] == 404
