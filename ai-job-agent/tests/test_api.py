from fastapi.testclient import TestClient

from job_helper_agent.main import create_app


def _request(client: TestClient, **overrides):
    payload = {
        "title": "Python Backend Engineer",
        "description": "Build reliable FastAPI services.",
        "excluded_keywords": [],
        "required_keywords": ["python"],
    }
    payload.update(overrides)
    return client.post("/api/v1/job-decisions", json=payload)


def test_health_and_graph_are_ready_without_external_dependencies() -> None:
    app = create_app()
    with TestClient(app) as client:
        live = client.get("/health/live")
        ready = client.get("/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "alive", "service": "job-helper-agent"}
    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ready",
        "checks": {"graph": "compiled", "config": "valid"},
    }


def test_graph_is_compiled_once_for_multiple_requests() -> None:
    app = create_app()
    with TestClient(app) as client:
        compiled_graph = app.state.decision_graph
        assert _request(client).status_code == 200
        assert _request(client, title="Another Python role").status_code == 200
        assert app.state.decision_graph is compiled_graph


def test_readiness_returns_503_when_graph_is_not_ready() -> None:
    app = create_app()
    with TestClient(app) as client:
        app.state.graph_ready = False
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "checks": {"graph": "unavailable", "config": "valid"},
    }


def test_excluded_keyword_is_rejected_before_required_keyword_match() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(
            client,
            description="Python role with frequent travel",
            excluded_keywords=["travel"],
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "REJECT"
    assert body["evidence"] == [{"rule": "excluded_keyword", "keyword": "travel"}]


def test_empty_job_information_requires_review() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, title="  ", description="\n", required_keywords=[])

    assert response.status_code == 200
    assert response.json()["decision"] == "REVIEW"
    assert response.json()["evidence"] == [
        {"rule": "insufficient_information", "keyword": None}
    ]


def test_missing_required_keyword_requires_review() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, required_keywords=["java"])

    assert response.status_code == 200
    assert response.json()["decision"] == "REVIEW"
    assert response.json()["evidence"] == [
        {"rule": "required_keywords_not_found", "keyword": "java"}
    ]


def test_matching_keyword_returns_match_and_normalizes_case_and_whitespace() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(
            client,
            title="  PYTHON   Backend Engineer  ",
            description="FastAPI\nservices",
            required_keywords=["  python  ", "FASTAPI"],
        )

    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "MATCH"
    assert body["evidence"] == [
        {"rule": "required_keyword", "keyword": "python"},
        {"rule": "required_keyword", "keyword": "fastapi"},
    ]


def test_short_ascii_keywords_require_token_boundaries() -> None:
    app = create_app()
    with TestClient(app) as client:
        false_positive = _request(
            client,
            title="Django JavaScript Engineer",
            description="Build browser applications",
            excluded_keywords=["go"],
            required_keywords=["java"],
        )
        actual_token = _request(
            client,
            title="Go and Java Engineer",
            excluded_keywords=["go"],
            required_keywords=["java"],
        )

    assert false_positive.status_code == 200
    assert false_positive.json()["decision"] == "REVIEW"
    assert false_positive.json()["evidence"] == [
        {"rule": "required_keywords_not_found", "keyword": "java"}
    ]
    assert actual_token.status_code == 200
    assert actual_token.json()["decision"] == "REJECT"
    assert actual_token.json()["evidence"] == [
        {"rule": "excluded_keyword", "keyword": "go"}
    ]


def test_all_ascii_technology_tokens_use_boundaries_and_support_common_punctuation() -> None:
    app = create_app()
    with TestClient(app) as client:
        for keyword, containing_word in (
            ("python", "cpython"),
            ("react", "reactive"),
            ("spring", "springboot"),
        ):
            response = _request(
                client,
                title=f"{containing_word} engineer",
                description="platform work",
                required_keywords=[keyword],
            )
            assert response.status_code == 200
            assert response.json()["decision"] == "REVIEW"

        punctuation = _request(
            client,
            title="C++ / .NET / Node.js / spring-boot 工程师",
            required_keywords=["c++", ".net", "node.js", "spring-boot"],
        )
        adjacent_chinese = _request(
            client,
            title="需要Python开发经验",
            required_keywords=["python"],
        )

    assert punctuation.status_code == 200
    assert punctuation.json()["decision"] == "MATCH"
    assert [item["keyword"] for item in punctuation.json()["evidence"]] == [
        "c++",
        ".net",
        "node.js",
        "spring-boot",
    ]
    assert adjacent_chinese.status_code == 200
    assert adjacent_chinese.json()["decision"] == "MATCH"


def test_chinese_keyword_keeps_phrase_substring_matching() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(
            client,
            title="Python 后端工程师",
            description="该岗位属于外包驻场项目",
            excluded_keywords=["外包"],
            required_keywords=[],
        )

    assert response.status_code == 200
    assert response.json()["decision"] == "REJECT"
    assert response.json()["evidence"] == [
        {"rule": "excluded_keyword", "keyword": "外包"}
    ]


def test_read_only_response_cannot_contain_an_action() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client)

    assert response.status_code == 200
    assert set(response.json()) == {"decision", "reasons", "evidence", "policy_version"}
    assert "action" not in response.text.casefold()


def test_unknown_request_fields_are_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, action="send_greeting")

    assert response.status_code == 422


def test_oversized_title_is_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, title="x" * 301)

    assert response.status_code == 422


def test_oversized_description_is_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, description="x" * 20_001)

    assert response.status_code == 422


def test_too_many_keywords_are_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, required_keywords=[f"keyword-{index}" for index in range(51)])

    assert response.status_code == 422


def test_oversized_keyword_is_rejected() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = _request(client, excluded_keywords=["x" * 101])

    assert response.status_code == 422
