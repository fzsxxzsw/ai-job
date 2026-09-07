"""Deterministic projections from observed facts; absence is never an unread receipt."""

import copy
import re

from ..config import Settings
from ..errors import ApiError
from ..rejection_engine.context import is_assertive_context
from ..rejection_engine.evidence import redact
from ..rejection_engine.rules import affirmed, analyze_rules
from .contracts import Observation

POLICY_VERSION = "outcome-policy-v1"
GRAPH_VERSION = "outcome-graph-v1"
REJECTION = (
    r"不予录用|决定不录用|拒绝.{0,6}(?:申请|应聘)"
    r"|(?:不能|无法|没法|不再|不会|暂不).{0,6}录用"
    r"|(?:招聘|应聘|录用|面试)流程.{0,8}(?:终止|结束|停止)"
    r"|另有(?:合适)?人选|已(?:经)?招满"
    r"|(?:岗位|职位|招聘|HC|名额).{0,8}(?:关闭|取消|冻结|暂停|已满)"
)
NON_FACTUAL = re.compile(
    r"如果|假如|假设|要是|若|据说|例如|举例|引用|原话|[“”‘’\"「」『』]"
    r"|忽略|系统指令|系统提示|扮演|(?:输出|返回|生成|标记|归类).{0,30}(?:JSON|积极|拒绝|POSITIVE|结论)"
)
OTHER_OBJECT = re.compile(
    r"时间|日期|星期|周[一二三四五六日天]|明天|后天|下午|上午|晚上"
    r"|地点|地址|会场|会议室|合同|条款|格式|文件名|版本|接口|代码|构建|编译"
    r"|单元测试|集成测试|测试用例|测试环境|设备|验证码|网络"
)
CANDIDATE_OBJECT = re.compile(
    r"你|您|候选人|应聘者|求职者|简历|履历|经验|学历|背景|技能|资历|能力|岗位|职位|薪资期望|期望薪资"
)
FIT_DENIAL = r"不合适|不适合|不匹配|不符(?:合)?.{0,8}(?:要求|岗位|条件)|不满足.{0,8}(?:要求|条件)"
HIRING_FAILURE = (
    r"(?:面试|笔试|简历筛选|招聘测评|面试考核|面试评估)(?:结果|审核|评估)?(?:没能|没有|未能|未|没)通过"
    r"|(?:没能|没有|未能|未|没)通过(?:本次|这次)?(?:面试|笔试|简历筛选|招聘测评)"
)
FIT_QUESTION = re.compile(
    r"(?:我的|我这份)(?:简历|经验|背景|履历).{0,12}(?:符合|适合|匹配).{0,8}(?:岗位|职位|要求)"
    r"|(?:我|本人).{0,5}(?:适合|符合|匹配).{0,8}(?:岗位|职位|要求)"
    r"|(?:我的|我这次|本次).{0,4}(?:面试|笔试|简历筛选).{0,8}(?:结果|通过)"
)
CONTINUATION = re.compile(
    r"(?:可以|能够|愿意|继续|再|一起|还可以).{0,8}(?:协商|商量|调整|修改|沟通|洽谈|讨论|聊聊)"
    r"|(?:改到|换到|调整到).{0,12}(?:面试|沟通)"
)
OTHER_ACTIVITY = re.compile(
    r"项目|需求|开发|代码|接口|构建|测试|供应商|客户|同事|对方|他们|其他候选人"
)
ASSENT = re.compile(r"^(?:可以(?:的)?|好的?|没问题|没有问题|行|可以安排)[，,。!！\s]*$")
POSITIVE = re.compile(
    r"(?:安排|邀请|约|参加|进行|来|到|线上|线下).{0,10}面试|面试.{0,14}(?:时间|安排|方便|可以|地点)|加.{0,6}微信|方便.{0,10}(?:电话|沟通)|进一步.{0,8}(?:沟通|交流)"
)
UNSAFE_POSITIVE = re.compile(
    r"如果|假如|假设|要是|若|据说|例如|举例|引用|原话|[“”‘’\"「」『』]|忽略|系统指令|系统提示|扮演|(?:输出|返回|生成|标记|归类).{0,30}(?:JSON|积极|POSITIVE|结论)|(?:不|没|未|无法|不能|不再|暂不|取消|暂停).{0,12}(?:面试|沟通|安排)|面试.{0,14}(?:未定|没定|没确定|待定|另行通知|尚未|还没|不确定)|不方便"
)
COURTESY = re.compile(
    r"^(?:好的?|好哒|收到|了解了?|明白了?|谢谢(?:您|你)?|感谢(?:您|你)?|嗯嗯?|OK|ok|祝.{0,12}(?:顺利|愉快))[，,。.!！\s]*$"
)


def outcome_signal(text: str, previous_user: str | None = None) -> str | None:
    """Require a hiring decision, not merely negative words about another object."""
    if NON_FACTUAL.search(text):
        return None
    if (
        ASSENT.fullmatch(text)
        and previous_user
        and not NON_FACTUAL.search(previous_user)
        and not UNSAFE_POSITIVE.search(previous_user)
        and re.search(r"[?？]|能否|可否|是否|可以|方便|希望|想|请", previous_user)
        and (
            POSITIVE.search(previous_user)
            or re.search(r"(?:电话|进一步).{0,6}(?:沟通|交流)", previous_user)
        )
    ):
        return "POSITIVE"
    clauses = [
        c.strip() for c in re.split(r"[，,。；;！!\n]|(?=改到|换到|调整到)", text) if c.strip()
    ]
    positive = any(
        POSITIVE.search(c)
        and not UNSAFE_POSITIVE.search(c)
        and not re.search(r"(?:面试|沟通).{0,14}(?:不合适|不匹配|不方便|未通过|没有通过)", c)
        for c in clauses
    )
    # Negated scheduling in one clause must not cancel a subsequent real invitation.
    continuing = any(
        CONTINUATION.search(c) and not re.search(r"不能|无法|不再|不会|没法|不可以", c)
        for c in clauses
    )
    if not is_assertive_context(text):
        return "POSITIVE" if positive else None
    terminal = affirmed(REJECTION, text) or any(affirmed(HIRING_FAILURE, c) for c in clauses)
    terminal |= any(
        not OTHER_ACTIVITY.search(c)
        and affirmed(
            r"(?:不能|无法|没法|不再|不会|暂不).{0,6}合作"
            r"|(?:招聘|应聘|面试|录用)流程.{0,6}(?:无法|不能|没法|不再|不会).{0,4}推进"
            r"|(?:无法|不能|没法|不再|不会|暂不)(?:继续)?推进(?:本次|这次|您的|你的)?(?:应聘|招聘|面试|录用)"
            r"|(?:我们|我司|公司|这边).{0,6}(?:无法|不能|没法|不再|不会|暂不)(?:继续)?推进(?:了|下去)?$",
            c,
        )
        for c in clauses
    )
    fitting = False
    for clause in clauses:
        if OTHER_OBJECT.search(clause):
            continue
        if CANDIDATE_OBJECT.search(clause) and affirmed(FIT_DENIAL, clause):
            fitting = True
    short_denial = bool(
        re.fullmatch(
            r"(?:抱歉[，,]?|不好意思[，,]?)?(?:您|你)?(?:不合适|不匹配|未通过|暂不考虑)[了。！!\s]*",
            text,
        )
    )
    if short_denial and previous_user and OTHER_OBJECT.search(previous_user):
        fitting = False
    if (
        short_denial
        and previous_user
        and FIT_QUESTION.search(previous_user)
        and not OTHER_OBJECT.search(previous_user)
    ):
        fitting = True
    # "We are not considering it" needs a candidate-related object in the same
    # message; a contract, date or technical choice is not an application denial.
    candidate_context = re.search(r"简历|履历|经验|学历|候选人|应聘|薪资期望|期望薪资", text)
    if candidate_context and affirmed(r"(?:我们|这边).{0,6}(?:暂不考虑|不考虑)(?:您|你|了)?", text):
        terminal = True
    if candidate_context and any(
        not OTHER_ACTIVITY.search(c)
        and affirmed(r"(?:无法|不能|没法|不再|不会|暂不)(?:继续)?推进(?:了|下去)?$", c)
        for c in clauses
    ):
        terminal = True
    if terminal:
        return "UNKNOWN" if positive or continuing else "REJECTED"
    if positive:
        return "POSITIVE"
    if continuing:
        return None
    return "REJECTED" if fitting else None


def chronological(message: dict) -> tuple[int, str]:
    return message.get("sentAt") or message["observedAt"], message["messageId"]


def analysis_messages(context: dict) -> list[dict]:
    """Bound model context while retaining the exact outcome-triggering evidence."""
    messages = [m for m in context["facts"].get("messages", []) if m["text"]]
    ids = {e["messageId"] for e in context["projection"]["evidence"]}
    pinned = [m for m in messages if m["messageId"] in ids]
    recent = [m for m in messages if m["messageId"] not in ids][-(40 - len(pinned)) :]
    return sorted(recent + pinned, key=chronological)


def merge_observation(facts: dict, observation: Observation, now: int) -> dict:
    result = copy.deepcopy(facts)
    timestamps = [observation.observedAt, observation.bindingObservedAt]
    timestamps.extend(m.sentAt for m in observation.messages if m.sentAt is not None)
    if observation.readEvidence:
        timestamps.append(observation.readEvidence.observedAt)
        if observation.readEvidence.observedAt > observation.observedAt:
            raise ApiError("阅读证据时间不能晚于本次观察", 422)
    if observation.coverage:
        timestamps.append(observation.coverage.checkedAt)
        if observation.coverage.checkedAt > observation.observedAt:
            raise ApiError("会话覆盖时间不能晚于本次观察", 422)
    if max(timestamps) > now + 60_000:
        raise ApiError("观察时间不正确", 422)
    messages = {m["messageId"]: m for m in result.get("messages", [])}
    for message in observation.messages:
        incoming = message.model_dump()
        incoming["text"] = redact(incoming["text"])
        incoming["observedAt"] = observation.observedAt
        alias = incoming.get("clientMessageId")
        matches = (
            [m for m in messages.values() if m.get("clientMessageId") == alias] if alias else []
        )
        previous = messages.get(incoming["messageId"])
        if matches:
            previous = previous or matches[0]
            if len(matches) > 1:
                raise ApiError("消息别名存在冲突", 409)
            if previous["messageId"] != incoming["messageId"]:
                if previous["messageId"].startswith("client:"):
                    messages.pop(previous["messageId"])
                elif incoming["messageId"].startswith("client:"):
                    incoming["messageId"] = previous["messageId"]
                else:
                    raise ApiError("消息客户端与服务端标识关联冲突", 409)
        if previous:
            if previous["role"] != incoming["role"] or (
                previous["text"] and incoming["text"] and previous["text"] != incoming["text"]
            ):
                raise ApiError("同一消息的角色或内容冲突", 409)
            if (
                previous.get("sentAt")
                and incoming.get("sentAt")
                and previous["sentAt"] != incoming["sentAt"]
            ):
                raise ApiError("同一消息的发送时间冲突", 409)
            incoming.update(
                text=previous["text"] or incoming["text"],
                sentAt=previous.get("sentAt") or incoming.get("sentAt"),
                clientMessageId=previous.get("clientMessageId") or incoming.get("clientMessageId"),
                observedAt=min(previous["observedAt"], incoming["observedAt"]),
                deliveryState="ACKNOWLEDGED"
                if "ACKNOWLEDGED" in (previous["deliveryState"], incoming["deliveryState"])
                else "UNKNOWN",
            )
        messages[incoming["messageId"]] = incoming
    if observation.readEvidence:
        evidence = observation.readEvidence.model_dump()
        target = messages.get(evidence["messageId"])
        if not target or target["role"] != "USER" or target["deliveryState"] != "ACKNOWLEDGED":
            raise ApiError("阅读证据必须对应当前岗位的真实已发送消息", 422)
        readings = result.setdefault("readings", {})
        prior = readings.get(evidence["messageId"])
        if prior and prior["state"] == "READ" and evidence["state"] == "READ":
            evidence["observedAt"] = min(prior["observedAt"], evidence["observedAt"])
            readings[evidence["messageId"]] = evidence
        if not prior or (
            prior["state"] != "READ"
            and (evidence["state"] == "READ" or evidence["observedAt"] > prior["observedAt"])
        ):
            readings[evidence["messageId"]] = evidence
    if observation.coverage:
        coverage = observation.coverage.model_dump()
        anchor, latest = (
            messages.get(coverage["anchorMessageId"]),
            messages.get(coverage["latestMessageId"]),
        )
        observed_ids = {m.messageId for m in observation.messages}
        if (
            not anchor
            or not latest
            or anchor["role"] != "USER"
            or anchor["deliveryState"] != "ACKNOWLEDGED"
        ):
            raise ApiError("会话覆盖缺少真实发出消息与末条消息", 422)
        if (
            coverage["anchorMessageId"] not in observed_ids
            or coverage["latestMessageId"] not in observed_ids
        ):
            raise ApiError("本次会话快照必须含覆盖起点及最新消息", 422)
        if not result.get("coverage") or coverage["checkedAt"] > result["coverage"]["checkedAt"]:
            result["coverage"] = coverage
    recent = sorted(messages.values(), key=chronological)[-200:]
    # Retain the material signal when a long courtesy exchange rolls off the
    # working window; history is still fully stored in observation rows.
    material_ids = {e["messageId"] for e in facts.get("projection", {}).get("evidence", [])}
    pinned = [m for m in messages.values() if m["messageId"] in material_ids]
    retained = {m["messageId"]: m for m in recent[-(200 - len(pinned)) :] + pinned}
    result["messages"] = sorted(retained.values(), key=chronological)
    result["readings"] = {
        key: reading for key, reading in result.get("readings", {}).items() if key in retained
    }
    return result


def project(facts: dict, settings: Settings, now: int) -> dict:
    messages = sorted(facts.get("messages", []), key=chronological)
    latest = messages[-1] if messages else None
    hr = [m for m in messages if m["role"] == "HR" and m["text"]]
    signals = []
    assent_context = {}
    previous = None
    for message in messages:
        prior = previous
        previous = message
        if message["role"] != "HR" or not message["text"]:
            continue
        text = message["text"]
        user_context = (
            prior["text"]
            if prior
            and prior["role"] == "USER"
            and prior.get("sentAt")
            and message.get("sentAt")
            and prior["sentAt"] <= message["sentAt"]
            else None
        )
        kind = outcome_signal(text, user_context)
        if kind == "POSITIVE" and user_context and ASSENT.fullmatch(text):
            assent_context[message["messageId"]] = prior
        if kind is None and signals and signals[-1][0] == "REJECTED":
            reasons = analyze_rules([{"id": "D1", "source": "HR_DIALOGUE", "text": text}])
            if reasons["explicitReasons"]:
                kind = "REJECTED"
        signature = (kind, "".join(text.split()))
        previous_signature = (
            (signals[-1][0], "".join(signals[-1][1]["text"].split())) if signals else None
        )
        if kind and signature != previous_signature:
            signals.append((kind, message))
    uncertain_time = len({kind for kind, _ in signals}) > 1 and any(
        not m.get("sentAt") for _, m in signals
    )
    uncertain = uncertain_time or bool(signals and signals[-1][0] == "UNKNOWN")
    latest_hr = signals[-1][1] if signals else (hr[-1] if hr else None)
    outcome, waiting, summary = "WAITING", "UNKNOWN", "已记录投递资料，等待真实沟通结果。"
    evidence = []
    if latest_hr:
        text = latest_hr["text"]
        if uncertain:
            outcome, summary = (
                "UNKNOWN",
                "观察到相反沟通信号，但消息时间不完整，需核对真实先后顺序。"
                if uncertain_time
                else "同一消息包含相互冲突的招聘表述，需人工核对，暂不判断拒绝。",
            )
        elif signals and signals[-1][0] == "REJECTED":
            outcome, summary = "REJECTED", "HR明确表达拒绝，已结合现有证据整理原因。"
        elif signals and signals[-1][0] == "POSITIVE":
            outcome, summary = "POSITIVE", "HR表达了进一步沟通或面试意向；这不等于录用。"
        else:
            outcome, summary = "REPLIED", "已观察到HR回复，尚不据此判断录用或拒绝。"
        evidence = [{"messageId": latest_hr["messageId"], "role": "HR", "quote": latest_hr["text"]}]
        if latest_hr["messageId"] in assent_context:
            proposal = assent_context[latest_hr["messageId"]]
            evidence.insert(
                0, {"messageId": proposal["messageId"], "role": "USER", "quote": proposal["text"]}
            )
        if uncertain:
            last_by_kind = {kind: message for kind, message in signals}
            evidence = [
                {"messageId": message["messageId"], "role": "HR", "quote": message["text"]}
                for message in sorted(last_by_kind.values(), key=chronological)
            ]
    if latest:
        waiting = "USER" if latest["role"] == "HR" else "HR"
        if outcome == "REJECTED":
            waiting = "NONE"
        elif latest["role"] == "USER" and COURTESY.fullmatch(latest["text"]):
            waiting = "NONE"
        elif uncertain:
            waiting = "UNKNOWN"
    status, deadline, read_state = "READY", None, "UNKNOWN"
    observed = max(
        (m["observedAt"] for m in messages), default=facts.get("applicationObservedAt", 0)
    )
    if latest and latest["role"] == "USER":
        reading = facts.get("readings", {}).get(latest["messageId"])
        if reading and waiting == "HR":
            read_state = reading["state"]
        if (
            waiting == "HR"
            and latest["deliveryState"] == "ACKNOWLEDGED"
            and latest.get("sentAt")
            and reading
        ):
            start = (
                max(latest["sentAt"], reading["observedAt"])
                if read_state == "READ"
                else latest["sentAt"]
            )
            hours = (
                settings.outcome_read_wait_hours
                if read_state == "READ"
                else settings.outcome_unread_wait_hours
            )
            deadline = start + hours * 3_600_000
            if now >= deadline:
                coverage = facts.get("coverage") or {}
                covered = (
                    coverage.get("anchorMessageId") == latest["messageId"]
                    and coverage.get("latestMessageId") == latest["messageId"]
                    and coverage.get("checkedAt", 0) >= deadline
                )
                if covered:
                    outcome, observed = "NO_REPLY", coverage["checkedAt"]
                    summary = "截至最近一次核实会话，HR尚未回复；这不能证明拒绝或拒绝原因。"
                else:
                    status = "WAITING_OBSERVATION"
                    summary = "等待新的可信会话观察，当前不能判断HR是否仍未回复。"
                deadline = None
        elif waiting == "HR":
            summary = "等待HR回复；发送时间或阅读证据不完整，尚不能判定未读不回或已读不回。"
    return dict(
        outcome=outcome,
        readState=read_state,
        waitingOn=waiting,
        processingStatus=status,
        nextCheckAt=deadline,
        asOf=observed,
        analysisKind="REJECTION_CAUSES" if outcome == "REJECTED" else "FACTS_ONLY",
        summary=summary,
        evidence=evidence,
        policyVersion=POLICY_VERSION,
        graphVersion=GRAPH_VERSION,
    )


def material_key(projection: dict) -> tuple:
    """Courtesy/replays can update observations without reopening a confirmed report."""
    signal = (
        tuple("".join(e["quote"].split()) for e in projection["evidence"])
        if projection["outcome"] in {"REJECTED", "POSITIVE", "UNKNOWN"}
        else ()
    )
    waiting = projection["waitingOn"]
    if projection["outcome"] == "POSITIVE" and waiting in {"USER", "NONE"}:
        waiting = "NEXT_STEP_ACKNOWLEDGED_OR_PENDING"
    return (
        projection["outcome"],
        projection["readState"],
        waiting,
        projection["processingStatus"],
        projection["nextCheckAt"],
        signal,
    )
