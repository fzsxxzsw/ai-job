import re

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


def explicit_resume_request(question):
    question = str(question or "")
    requested = re.search(
        r"(?:发|给|传|提供|看看|看下|看一下).{0,8}简历|简历.{0,8}(?:发|给|传|提供)",
        question,
    )
    refused = re.search(
        r"不.{0,3}(?:发|传|需要|用)|已.{0,3}(?:发送|收到)|不太合适|不合适|不匹配|拒绝|招满",
        question,
    )
    return bool(requested and not refused)


def automatic_resume_authorized(job, input_, kind, payload):
    if job["kind"] != "REPLY" or kind not in {"SEND_RESUME", "ACCEPT_RESUME"}:
        return False
    if kind == "SEND_RESUME":
        return explicit_resume_request(input_.get("question"))
    return input_.get("exchangeRequest") == {
        "kind": "ACCEPT_RESUME",
        "requestMessageId": payload.get("requestMessageId"),
    }


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
        automatic_follow_up = job["kind"] == "FOLLOW_UP" and kind == "SEND_TEXT"
        automatic_resume = automatic_resume_authorized(job, input_, kind, payload)
        artifact["actions"].append(
            {
                "kind": kind,
                "payload": payload,
                "payloadHash": digest(payload),
                "approvalStatus": "NOT_REQUIRED"
                if automatic_follow_up or automatic_resume
                else "PENDING"
                if kind in SENSITIVE
                else "NOT_REQUIRED",
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
    if job["kind"] == "FOLLOW_UP":
        if await is_stopped(service.db, uid, input_["jobKey"]):
            result["decision"] = decision("STOP", "当前会话或 AI 回复已暂停")
            return artifact
        if await conversation_exclusion(
            service.db,
            uid,
            input_["jobKey"],
            "自动跟进投递进度",
            input_.get("jobInfo"),
        ):
            result["decision"] = decision("STOP", "命中现有岗位或对话排除规则")
            return artifact
        system, _, config = await system_prompt(frozen, uid)
        prompt = (
            "请根据真实简历、岗位资料和已有对话，生成一条自然、克制的中文求职跟进消息。"
            "只输出准备发送的正文，1到2句话，不虚构经历，不催促，不讨论薪资，"
            "表达仍有兴趣并礼貌询问岗位进展。"
        )
        _, response = await generate_draft(
            service.model,
            service.settings,
            config,
            system,
            bundle["preference"],
            bundle["history"],
            prompt,
            input_.get("jobInfo"),
        )
        text = str(response.get("answerContent") or "").strip()
        if not text:
            result["decision"] = decision("STOP", "模型未生成可发送的跟进正文")
            return artifact
        action("SEND_TEXT", {"text": text[:500]})
        result["decision"] = decision("SEND", "跟进正文已生成，等待安全发送与平台回执")
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
    elif job["kind"] == "FOLLOW_UP":
        if (
            code not in {"SEND", "STOP", "MISSING_MATERIALS"}
            or len(actions) > 1
            or actions
            and (
                actions[0].get("kind") != "SEND_TEXT"
                or actions[0].get("approvalStatus") != "NOT_REQUIRED"
                or not isinstance(actions[0].get("payload", {}).get("text"), str)
                or not actions[0]["payload"]["text"].strip()
                or len(actions[0]["payload"]["text"]) > 500
            )
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
        expected_approval = (
            "NOT_REQUIRED"
            if job["kind"] == "FOLLOW_UP"
            and kind == "SEND_TEXT"
            or automatic_resume_authorized(job, input_, kind, payload)
            else "PENDING"
            if kind in SENSITIVE
            else "NOT_REQUIRED"
        )
        if set(payload) != expected or action.get("approvalStatus") != expected_approval:
            return False
    return True
