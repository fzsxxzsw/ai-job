from ..contracts import FilterInput
from ..conversation import generate_draft, is_stopped, system_prompt
from ..database import dumps, loads
from ..employment_exclusions import conversation_exclusion
from ..filtering import filter_job
from .storage import SENSITIVE, digest


class FrozenInputs:
    """Model helpers read frozen personal facts; keys remain in current private config."""

    def __init__(self, db, uid, bundle):
        self.db, self.uid, self.bundle = db, uid, bundle

    async def user(self, uid):
        if uid != self.uid:
            return None
        return {"preference": dumps(self.bundle["preference"]), "is_active": True}

    async def resume(self, uid):
        return self.bundle["resume"] if uid == self.uid else None

    async def ai_config(self, uid):
        row = await self.db.ai_config(uid)
        return (
            {**dict(row or {}), "user_prompt": self.bundle["userPrompt"]}
            if uid == self.uid
            else None
        )


def decision(code, reason):
    return {"code": code, "reason": reason}


async def compute(service, job):
    if job["kind"] == "CAREER_REVIEW":
        from ..career.review_compute import compute_assisted_review

        return await compute_assisted_review(service, job)
    uid = job["user_id"]
    raw = loads(job["input_json"], {})
    input_ = raw["input"]
    bundle = loads(job["context_json"], {})
    result = {
        "schemaVersion": 1,
        "kind": job["kind"],
        "decision": None,
        "analysis": None,
        "missingMaterials": bundle["missingMaterials"],
    }
    artifact = {
        "inputHash": job["input_hash"],
        "result": result,
        "actions": [],
        "highInterest": False,
    }
    if bundle["missingMaterials"]:
        result["decision"] = decision("MISSING_MATERIALS", "缺少已核实资料，本次未安排任何发送")
        return artifact
    frozen = FrozenInputs(service.db, uid, bundle)
    binding = {
        "encryptJobId": job["encrypt_job_id"],
        "bossId": job["boss_id"],
        "conversationKey": job["conversation_key"],
    }

    def action(kind, extra=None):
        payload = {**binding, **(extra or {})}
        artifact["actions"].append(
            {
                "kind": kind,
                "payload": payload,
                "payloadHash": digest(payload),
                "approvalStatus": "PENDING" if kind in SENSITIVE else "NOT_REQUIRED",
            }
        )

    if job["kind"] == "APPLICATION":
        if not input_["localAssessment"]["passed"]:
            result["decision"] = decision(
                "REJECT", input_["localAssessment"]["reason"] or "未通过本地硬性筛选"
            )
            return artifact
        result["analysis"] = await filter_job(
            frozen,
            service.model,
            service.settings,
            uid,
            FilterInput.model_validate(input_["filterInput"]),
        )
        if result["analysis"]["filter"]:
            result["decision"] = decision("REJECT", result["analysis"]["reason"])
            return artifact
        result["decision"] = decision("CONTACT", "已通过本地及服务端筛选，等待逐项平台执行回执")
        action("CONTACT_JOB")
        if input_["greeting"]["enabled"] and input_["greeting"]["text"].strip():
            action("SEND_GREETING", {"text": input_["greeting"]["text"]})
        return artifact
    if await is_stopped(service.db, uid, input_["jobKey"]):
        result["decision"] = decision("STOP", "当前会话或 AI 回复已暂停")
        return artifact
    if await conversation_exclusion(
        service.db, uid, input_["jobKey"], input_["question"], input_.get("jobInfo")
    ):
        result["decision"] = decision("STOP", "命中现有岗位或对话排除规则")
        return artifact
    pref = bundle["preference"]
    rounds = bundle["rounds"] if isinstance(bundle["rounds"], int) else 0
    keywords = pref.get("crK") if isinstance(pref.get("crK"), list) else []
    limit = pref.get("crC")
    high = bool(
        (pref.get("hiaE") or pref.get("crE"))
        and (
            input_["question"] in keywords
            or (isinstance(limit, int) and limit > 0 and rounds >= limit)
        )
    )
    artifact["highInterest"] = high
    if high and pref.get("hiaE"):
        async with service.db.engine.begin() as c:
            await service.db.set_control(c, uid, "stop:" + input_["jobKey"], True)
        result["decision"] = decision("STOP", "已达到现有高意向或回复轮次暂停条件")
        return artifact
    system, _, config = await system_prompt(frozen, uid)
    _, response = await generate_draft(
        service.model,
        service.settings,
        config,
        system,
        pref,
        bundle["history"],
        input_["question"],
        input_.get("jobInfo"),
    )
    if response["answerTypeList"] == [3] and not input_.get("exchangeRequest"):
        result["decision"] = decision("STOP", "本轮无需自动回复")
        return artifact
    if response["answerContent"]:
        action("SEND_TEXT", {"text": response["answerContent"]})
    exchange = input_.get("exchangeRequest")
    if exchange:
        extra = {"requestMessageId": exchange["requestMessageId"]}
        if exchange["kind"] == "ACCEPT_RESUME":
            extra.update(resumeVersionId=None, platformResumeId=input_.get("platformResumeId"))
        action(exchange["kind"], extra)
    if 1 in response["operationTypeList"] and (not exchange or exchange["kind"] != "ACCEPT_RESUME"):
        action(
            "SEND_RESUME",
            {"resumeVersionId": None, "platformResumeId": input_.get("platformResumeId")},
        )
    result["decision"] = decision(
        "SEND" if artifact["actions"] else "STOP",
        "草稿已生成，等待具体审批或平台发送确认" if artifact["actions"] else "本轮无需发送",
    )
    return artifact


def validate_artifact(job, artifact):
    """Independent publication checks using frozen identities and fixed action kinds."""
    if not isinstance(artifact, dict) or artifact.get("inputHash") != job["input_hash"]:
        return False
    if job["kind"] == "CAREER_REVIEW":
        from ..career.review_compute import validate_review

        return validate_review(job, artifact)
    raw = loads(job["input_json"], {})
    input_ = raw["input"]
    result, actions = artifact.get("result", {}), artifact.get("actions")
    if not isinstance(actions, list) or len(actions) > 3 or result.get("kind") != job["kind"]:
        return False
    code = result.get("decision", {}).get("code")
    if code not in {"SEND", "CONTACT", "REJECT", "STOP", "MISSING_MATERIALS"}:
        return False
    if (
        result.get("missingMaterials")
        and actions
        or code in {"REJECT", "STOP", "MISSING_MATERIALS"}
        and actions
    ):
        return False
    if job["kind"] == "APPLICATION":
        if not input_["localAssessment"]["passed"] and actions:
            return False
        if actions and (
            [a.get("kind") for a in actions]
            not in [["CONTACT_JOB"], ["CONTACT_JOB", "SEND_GREETING"]]
            or result.get("analysis", {}).get("filter") is not False
        ):
            return False
    for action in actions:
        kind, payload = action.get("kind"), action.get("payload", {})
        allowed = (
            {"CONTACT_JOB", "SEND_GREETING"}
            if job["kind"] == "APPLICATION"
            else {"SEND_TEXT", "SEND_RESUME", "ACCEPT_PHONE", "ACCEPT_WECHAT", "ACCEPT_RESUME"}
        )
        if kind not in allowed or action.get("payloadHash") != digest(payload):
            return False
        if any(
            payload.get(key) != raw[key] for key in ("encryptJobId", "bossId", "conversationKey")
        ):
            return False
        expected = {"encryptJobId", "bossId", "conversationKey"}
        if kind in {"SEND_TEXT", "SEND_GREETING"}:
            expected.add("text")
            text = payload.get("text")
            if not isinstance(text, str) or not 1 <= len(text) <= 5000 or "COMMAND_" in text:
                return False
            if kind == "SEND_GREETING" and (
                not input_["greeting"]["enabled"] or text != input_["greeting"]["text"]
            ):
                return False
        if kind.startswith("ACCEPT_"):
            expected.add("requestMessageId")
            if input_.get("exchangeRequest") != {
                "kind": kind,
                "requestMessageId": payload.get("requestMessageId"),
            }:
                return False
        if kind in {"SEND_RESUME", "ACCEPT_RESUME"}:
            expected.update({"resumeVersionId", "platformResumeId"})
            if payload.get("resumeVersionId") is not None or payload.get(
                "platformResumeId"
            ) != input_.get("platformResumeId"):
                return False
        if set(payload) != expected or action.get("approvalStatus") != (
            "PENDING" if kind in SENSITIVE else "NOT_REQUIRED"
        ):
            return False
    return True
