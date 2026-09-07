import json
from pathlib import Path


def test_frontend_preference_contract_round_trips_without_read_only_user_fields(client):
    fixture = json.loads(
        (Path(__file__).parent / "fixtures/preference-save.json").read_text(encoding="utf-8")
    )
    before = client.post("/api/user/userinfo").json()["data"]
    # The former spread of user_view is rejected, reproducing the reported 422.
    assert client.post("/api/user/save/preference", json=fixture["user"]).status_code == 422
    assert client.post("/api/user/userinfo").json()["data"] == before
    assert client.post("/api/user/save/preference", json=fixture["payload"]).status_code == 200
    after = client.post("/api/user/userinfo").json()["data"]
    for field in ("phone", "email", "preference", "aiSeatStatus"):
        assert after[field] == fixture["payload"][field]
    for field in ("id", "resumeId", "inviteCode", "bindInviteCode"):
        assert after[field] == before[field]
