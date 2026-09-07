"""Revalidate stored artifacts against frozen evidence, independently of model calls."""

import re

from ..database import dumps
from ..rejection_engine.evidence import build_evidence
from ..rejection_engine.reviewer import validated_findings
from ..rejection_engine.rules import analyze_rules
from .policy import analysis_messages

MODEL_NOTES = {
    "证据正文已保留；总量超过本次模型输入上限，已使用规则分析",
    "模型未提供通过证据校验的新结论，本次仅使用规则分析",
    "模型不可用或输出未通过证据校验，本次仅使用规则分析",
}
OBSERVATION_NOTE = "缺少到期后的可信会话观察，尚不能确认无回复。"


def published_report(report: dict, context: dict) -> dict:
    """Expose explicit provenance without treating engine evidence IDs as platform IDs."""
    messages = analysis_messages(context)
    evidence = []
    for item in report["evidence"]:
        if context["projection"]["analysisKind"] == "FACTS_ONLY":
            evidence.append(
                dict(
                    evidenceId="M:" + item["messageId"],
                    source="CHAT",
                    messageId=item["messageId"],
                    role=item["role"],
                    quote=item["quote"],
                )
            )
            continue
        if item["source"] in {"HR_DIALOGUE", "USER_DIALOGUE"}:
            message = messages[int(item["id"][1:]) - 1]
            evidence.append(
                dict(
                    evidenceId=item["id"],
                    source="CHAT",
                    messageId=message["messageId"],
                    role=message["role"],
                    quote=item["text"],
                )
            )
        else:
            evidence.append(
                dict(
                    evidenceId=item["id"],
                    source="RESUME" if item["source"] == "RESUME_SNAPSHOT" else "JOB",
                    messageId=None,
                    role=None,
                    quote=item["text"],
                )
            )
    return {**report, "evidence": evidence}


def valid_report(report: dict, context: dict) -> bool:
    projection = context["projection"]
    if set(report) != {
        "outcome",
        "readState",
        "waitingOn",
        "asOf",
        "summary",
        "analysisSource",
        "evidence",
        "explicitReasons",
        "inferredRisks",
        "unknowns",
        "suggestions",
    }:
        return False
    if report.get("analysisSource") not in {"RULES_ONLY", "RULES_AI"}:
        return False
    list_keys = ("evidence", "explicitReasons", "inferredRisks", "unknowns", "suggestions")
    if any(not isinstance(report.get(key), list) for key in list_keys):
        return False
    if any(not isinstance(v, str) for key in ("unknowns", "suggestions") for v in report[key]):
        return False
    if projection["analysisKind"] == "FACTS_ONLY":
        return (
            report["analysisSource"] == "RULES_ONLY"
            and report["evidence"] == projection["evidence"]
            and not report["explicitReasons"]
            and not report["inferredRisks"]
            and not report["suggestions"]
            and report["unknowns"]
            == (
                [OBSERVATION_NOTE]
                if projection["processingStatus"] == "WAITING_OBSERVATION"
                else []
            )
        )
    messages = [{"role": m["role"], "text": m["text"]} for m in analysis_messages(context)]
    evidence = build_evidence(messages, context["snapshot"])
    baseline = analyze_rules(evidence)
    if report["evidence"] != evidence or report["suggestions"] != baseline["suggestions"]:
        return False
    if not set(report["unknowns"]) <= set(baseline["unknowns"]) | MODEL_NOTES:
        return False
    model_findings = 0
    for key, kind in (("explicitReasons", "EXPLICIT"), ("inferredRisks", "INFERRED")):
        seen = set()
        for item in report[key]:
            if not isinstance(item, dict) or set(item) != {
                "code",
                "label",
                "classification",
                "reason",
                "evidenceIds",
            }:
                return False
            if not isinstance(item["code"], str) or item["code"] in seen:
                return False
            seen.add(item["code"])
            if item["classification"] != kind:
                return False
            if item in baseline[key]:
                continue
            if report["analysisSource"] != "RULES_AI" or not isinstance(item["reason"], str):
                return False
            # The reviewer renders accepted model citations in a fixed quoted format.
            # Reconstruct only citations whose complete text occurs in frozen evidence;
            # its existing validator then checks source roles, polarity and taxonomy.
            ids = item["evidenceIds"]
            if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
                return False
            quotes = re.findall("“([^“”]+)”", item["reason"])
            citations = []
            for quote in quotes:
                match = next((e for e in evidence if e["id"] in ids and quote in e["text"]), None)
                if match is None:
                    return False
                citations.append({"evidenceId": match["id"], "quote": quote})
            accepted = validated_findings(
                dumps(
                    {
                        "findings": [
                            {
                                "code": item["code"],
                                "classification": kind,
                                "citations": citations,
                            }
                        ]
                    }
                ),
                evidence,
            )
            if accepted != [item]:
                return False
            model_findings += 1
        if not {item["code"] for item in baseline[key]} <= seen:
            return False
    return report["analysisSource"] != "RULES_AI" or model_findings > 0
