"""Evidence preparation shared by rules and the model reviewer."""

import json
import re
from typing import NotRequired, TypedDict


class Evidence(TypedDict):
    id: str
    source: str
    text: str
    truncated: NotRequired[bool]
    originalLength: NotRequired[int]


def strip_private_fields(value: object, depth: int = 0) -> object:
    if depth > 12:
        return "[深层字段已省略]"
    if isinstance(value, list):
        return [strip_private_fields(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, child in value.items():
        name = re.sub(r"[^a-z0-9]", "", str(key).lower())
        if name.endswith(
            ("id", "token", "key", "secret", "password", "url", "avatar", "logo", "phone", "email")
        ):
            continue
        result[key] = strip_private_fields(child, depth + 1)
    return result


def redact(value: str) -> str:
    try:
        parsed = json.loads(value)
        if isinstance(parsed, (dict, list)):
            value = json.dumps(strip_private_fields(parsed), ensure_ascii=False)
    except (ValueError, TypeError, RecursionError):
        pass
    value = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱已隐藏]", value)
    value = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[电话已隐藏]", value)
    value = re.sub(r"(?i)(?:bearer\s+|sk-)[A-Za-z0-9._-]{8,}", "[密钥已隐藏]", value)
    return value.replace("\x00", "").strip()


def build_evidence(messages: list[dict[str, str]], snapshot) -> list[Evidence]:
    evidence: list[Evidence] = [
        {
            "id": f"D{index}",
            "source": "HR_DIALOGUE" if item["role"] == "HR" else "USER_DIALOGUE",
            "text": item["text"],
        }
        for index, item in enumerate(messages, 1)
    ]
    if snapshot:
        for ident, source, column, limit in (
            ("J1", "JOB_BASE", "job_base_info", 30000),
            ("J2", "JOB_DESCRIPTION", "job_ext_info", 60000),
            ("R1", "RESUME_SNAPSHOT", "resume_content", 100000),
        ):
            original = str(snapshot[column] or "")
            content = redact(original)
            if content:
                item: Evidence = {"id": ident, "source": source, "text": content}
                # Preserve all contract-sized input, even if JSON formatting in
                # redaction expands it. Limits only bound oversized legacy rows.
                if len(original) > limit and len(content) > limit:
                    item.update(text=content[:limit], truncated=True, originalLength=len(content))
                evidence.append(item)
    return evidence
