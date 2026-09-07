import json
import sqlite3
from dataclasses import replace

from fastapi.testclient import TestClient

from job_helper_api.main import create_app


def browser_payload(**overrides):
    return {
        "prompt": "",
        "jobBaseInfo": json.dumps({"jobName": "Python开发", "skills": ["Python", "Docker"]}),
        "jobExtInfo": json.dumps({"postDescription": "要求熟悉Python，Redis优先"}),
        "resumeMatchEnabled": True,
        "minMatchScore": 100,
        "titleRuleStatus": "PASS",
        "titleMatchedKeywords": ["Python"],
        **overrides,
    }


def test_current_chrome_payload_uses_local_scoring_without_any_model_call(client, world):
    response = client.post("/api/job/filter/one", json=browser_payload())
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["engine"] == "LOCAL_RULES_V2" and result["decisionStatus"] == "MATCH"
    assert result["filter"] is False and 0 < result["score"] < 100
    assert result["titleScore"] == 100 and "Python" in result["matchedStrengths"]
    assert "Docker" in result["gaps"] and world["fake"].calls == []


def test_local_match_uses_whole_skill_terms_and_advisory_score(client, world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE user_resume SET resume_content='reactive系统和javascript' WHERE user_id=3"
        )
    payload = browser_payload(
        jobBaseInfo=json.dumps({"skills": ["React", "Java"]}), jobExtInfo="{}", titleRuleStatus=None
    )
    result = client.post("/api/job/filter/one", json=payload).json()["data"]
    assert result["score"] == 0 and result["filter"] is False
    assert result["matchedStrengths"] == [] and set(result["gaps"]) == {"React", "Java"}


def test_missing_resume_is_unknown_not_automatic_pass(client, world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_resume SET is_active=0 WHERE user_id=3")
    result = client.post("/api/job/filter/one", json=browser_payload()).json()["data"]
    assert result["decisionStatus"] == "UNKNOWN" and result["filter"] is True
    assert world["fake"].calls == []


def test_explicit_conditions_use_real_resume_in_model_prompt(client, world):
    world["fake"].output = '{"filter":false,"reason":"附加条件符合","score":62}'
    result = client.post("/api/job/filter/one", json=browser_payload(prompt="要求双休")).json()[
        "data"
    ]
    assert result["decisionStatus"] == "MATCH" and result["engine"] == "AI"
    assert "测试候选人" in world["fake"].calls[-1]["messages"][-1]["content"]


def test_legacy_education_fact_is_explicit_and_preferred_degree_is_not_hard_gate(world):
    config = replace(world["settings"], confirmed_education="全日制本科")
    with TestClient(create_app(config, world["transport"])) as client:
        client.headers["Authorization"] = client.post(
            "/api/user/silently/login", params={"uniqueId": "boss-owner"}
        ).json()["data"]
        payload = browser_payload(jobExtInfo=json.dumps({"postDescription": "要求硕士及以上学历"}))
        assert (
            client.post("/api/job/filter/one", json=payload).json()["data"]["decisionStatus"]
            == "REJECT"
        )
        payload["jobExtInfo"] = json.dumps({"postDescription": "硕士优先；熟悉Python"})
        assert (
            client.post("/api/job/filter/one", json=payload).json()["data"]["decisionStatus"]
            == "MATCH"
        )
    assert world["fake"].calls == []
