import re
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from job_helper_agent.models import Decision


class DecisionState(TypedDict):
    title: str
    description: str
    excluded_keywords: list[str]
    required_keywords: list[str]
    policy_version: str
    normalized_text: NotRequired[str]
    normalized_excluded_keywords: NotRequired[list[str]]
    normalized_required_keywords: NotRequired[list[str]]
    decision: NotRequired[str]
    reasons: NotRequired[list[str]]
    evidence: NotRequired[list[dict[str, str | None]]]


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().casefold()


def _normalize_keywords(keywords: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for keyword in keywords:
        candidate = _normalize(keyword)
        if candidate and candidate not in seen:
            seen.add(candidate)
            normalized.append(candidate)
    return normalized


def _keyword_matches(normalized_text: str, normalized_keyword: str) -> bool:
    """Match Chinese/phrases as substrings and ASCII technology tokens as words."""

    is_ascii_technology_token = (
        normalized_keyword.isascii()
        and re.fullmatch(r"[a-z0-9.+#-]+", normalized_keyword) is not None
        and re.search(r"[a-z0-9]", normalized_keyword) is not None
    )
    if is_ascii_technology_token:
        pattern = rf"(?<![a-z0-9]){re.escape(normalized_keyword)}(?![a-z0-9])"
        return re.search(pattern, normalized_text) is not None
    return normalized_keyword in normalized_text


def normalize_job(state: DecisionState) -> dict[str, object]:
    """Return a partial state update; never mutate the input state."""

    title = _normalize(state["title"])
    description = _normalize(state["description"])
    return {
        "normalized_text": " ".join(part for part in (title, description) if part),
        "normalized_excluded_keywords": _normalize_keywords(state["excluded_keywords"]),
        "normalized_required_keywords": _normalize_keywords(state["required_keywords"]),
    }


def apply_keyword_policy(state: DecisionState) -> dict[str, object]:
    """Apply the deterministic, fail-closed Phase 1 policy."""

    normalized_text = state.get("normalized_text", "")
    excluded_keywords = state.get("normalized_excluded_keywords", [])
    required_keywords = state.get("normalized_required_keywords", [])

    excluded_matches = [
        keyword for keyword in excluded_keywords if _keyword_matches(normalized_text, keyword)
    ]
    if excluded_matches:
        return {
            "decision": Decision.REJECT.value,
            "reasons": ["An excluded keyword was found in the job information."],
            "evidence": [
                {"rule": "excluded_keyword", "keyword": keyword}
                for keyword in excluded_matches
            ],
        }

    if not normalized_text:
        return {
            "decision": Decision.REVIEW.value,
            "reasons": ["The job title and description do not contain enough information."],
            "evidence": [{"rule": "insufficient_information", "keyword": None}],
        }

    required_matches = [
        keyword for keyword in required_keywords if _keyword_matches(normalized_text, keyword)
    ]
    if required_keywords and not required_matches:
        return {
            "decision": Decision.REVIEW.value,
            "reasons": ["None of the required keywords were found."],
            "evidence": [
                {"rule": "required_keywords_not_found", "keyword": keyword}
                for keyword in required_keywords
            ],
        }

    evidence = (
        [
            {"rule": "required_keyword", "keyword": keyword}
            for keyword in required_matches
        ]
        if required_matches
        else [{"rule": "job_information_present", "keyword": None}]
    )
    return {
        "decision": Decision.MATCH.value,
        "reasons": ["The job passed the read-only keyword policy."],
        "evidence": evidence,
    }


def build_decision_graph():
    """Build and compile the graph once during FastAPI lifespan startup.

    The graph uses the official StateGraph/START/END Graph API pattern:
    https://docs.langchain.com/oss/python/langgraph/graph-api
    """

    builder = StateGraph(DecisionState)
    builder.add_node("normalize_job", normalize_job)
    builder.add_node("apply_keyword_policy", apply_keyword_policy)
    builder.add_edge(START, "normalize_job")
    builder.add_edge("normalize_job", "apply_keyword_policy")
    builder.add_edge("apply_keyword_policy", END)
    return builder.compile()
