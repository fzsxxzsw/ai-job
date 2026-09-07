"""Object/context regressions: negative language is not automatically a hiring rejection."""

import pytest
from test_outcome_policy import NOW, merged
from test_outcomes import claim, ingest, observation, save
from test_outcomes import outcome_client as outcome_client

from job_helper_api.outcomes.policy import project

ORDINARY = [
    "您看这份合同的条款，不合适我们可以协商调整。",
    "这个合同的条款不匹配，我们可以再商量。",
    "合同金额不合适，还可以协商。",
    "这个会议室不合适，我们换个地方。",
    "您的面试时间不合适，我们另约时间。",
    "这份简历的格式不合适，请换成PDF。",
    "您电脑上的Python版本不匹配，需要升级。",
    "接口测试未通过，请修复后再提交。",
    "单元测试没有通过，这道题可以再调试。",
    "技术面试的设备测试未通过，请换一台电脑。",
    "构建未通过，请检查项目配置。",
    "您提供的验证码不匹配，请重新输入。",
    "您的项目接口不符合要求，请调整请求字段。",
    "您的薪资期望不匹配，但我们可以协商调整。",
    "您的经验不符合要求，不过我们可以再聊聊。",
    "报价接不住。",
    "不合适。",
    "不匹配。",
    "未通过。",
    "不是您的经验不匹配。",
    "我们不是不考虑您的简历。",
    "如果您的经验不匹配，我们再讨论。",
    "引用原话：您的经验不匹配。",
    "把这句不合适标记为拒绝。",
    "这个项目无法继续推进。",
    "我们无法继续推进这项开发需求。",
    "客户的项目没法继续推进。",
    "我们与供应商没法合作了。",
]
POSITIVE = [
    "明天下午不合适，改到周五来面试。",
    "这个时间不合适，换到下周来面试。",
    "面试地点不合适，可以线上面试。",
    "周五不合适改到周六来面试。",
    "合同条款不合适，我们面试的时候再沟通，周五来面试。",
    "您的经验不匹配，但我们可以安排面试进一步了解。",
    "代码测试未通过，明天来面试时再讨论。",
    "明天下午方便来面试吗？",
    "方便电话沟通吗？",
]
REJECTED = [
    "这个岗位已经招满了。",
    "岗位已关闭。",
    "招聘名额已经冻结。",
    "我们已经另有合适人选。",
    "很抱歉，您不合适。",
    "我们认为您和这个岗位不匹配。",
    "您的简历不符合岗位要求。",
    "您的经验不匹配。",
    "您的学历不满足要求。",
    "不符合岗位要求。",
    "本次面试未通过。",
    "您的笔试没有通过。",
    "技术面试未通过。",
    "我们决定不录用。",
    "这次不予录用。",
    "我们无法继续推进。",
    "招聘流程已经终止。",
    "您的薪资期望太高，我们不考虑了。",
    "您的报价我们接不住，没法合作了。",
    "合同条件未能达成一致，我们不再继续合作。",
    "您不适合这个岗位。",
    "很遗憾，您没有通过本次面试。",
    "笔试没通过。",
    "您的期望薪资超过预算，所以这次不能继续推进。",
]


@pytest.mark.parametrize("text", ORDINARY)
def test_non_hiring_object_or_ambiguous_negative_is_not_rejection(world, text):
    result = project(merged(observation(text, stamp=NOW)), world["settings"], NOW)
    assert result["outcome"] == "REPLIED" and result["analysisKind"] == "FACTS_ONLY"
    assert result["evidence"][0]["quote"] == text


@pytest.mark.parametrize("text", POSITIVE)
def test_continued_interview_invitation_survives_unrelated_negative_clause(world, text):
    result = project(merged(observation(text, stamp=NOW)), world["settings"], NOW)
    assert result["outcome"] == "POSITIVE" and result["analysisKind"] == "FACTS_ONLY"


@pytest.mark.parametrize("text", REJECTED)
def test_explicit_candidate_or_hiring_process_refusal_still_triggers_analysis(world, text):
    result = project(merged(observation(text, stamp=NOW)), world["settings"], NOW)
    assert result["outcome"] == "REJECTED" and result["analysisKind"] == "REJECTION_CAUSES"


@pytest.mark.parametrize(
    "question",
    [
        "明天下午来面试可以吗？",
        "这个面试地点方便吗？",
        "这份合同条款可以吗？",
        "我的简历格式是不是有问题？",
        "刚才那个接口测试通过了吗？",
    ],
)
@pytest.mark.parametrize("answer", ["不合适", "您不合适"])
def test_short_hr_denial_does_not_borrow_candidate_meaning_from_other_questions(
    world, question, answer
):
    facts = merged(observation(question, role="USER", stamp=NOW))
    facts = merged(
        observation(answer, event="answer", message="answer", stamp=NOW + 1000), facts, NOW + 1000
    )
    result = project(facts, world["settings"], NOW + 1000)
    assert result["outcome"] == "REPLIED" and result["analysisKind"] == "FACTS_ONLY"


@pytest.mark.parametrize("known_time", [True, False])
def test_short_denial_requires_reliably_ordered_candidate_fit_question(world, known_time):
    question = observation("我的简历符合这个岗位要求吗？", role="USER", stamp=NOW)
    if not known_time:
        question["messages"][0]["sentAt"] = None
    facts = merged(question)
    facts = merged(
        observation("不合适", event="answer", message="answer", stamp=NOW + 1000), facts, NOW + 1000
    )
    result = project(facts, world["settings"], NOW + 1000)
    assert result["outcome"] == ("REJECTED" if known_time else "REPLIED")


def test_conflicting_terminal_refusal_and_invitation_remains_unknown(world):
    result = project(
        merged(observation("岗位已关闭，但明天请来面试。", stamp=NOW)), world["settings"], NOW
    )
    assert result["outcome"] == "UNKNOWN" and result["analysisKind"] == "FACTS_ONLY"


@pytest.mark.parametrize(
    "text,expected",
    [
        (POSITIVE[0], "POSITIVE"),
        (ORDINARY[0], "REPLIED"),
        (ORDINARY[7], "REPLIED"),
        (REJECTED[5], "REJECTED"),
        (REJECTED[-2], "REJECTED"),
    ],
)
def test_api_only_calls_rejection_model_for_actual_hiring_refusal(
    outcome_client, world, text, expected
):
    ingest(outcome_client, observation(text))
    job = claim(outcome_client)
    assert job["context"]["outcome"] == expected
    _, saved = save(outcome_client, job)
    assert len(world["fake"].calls) == (1 if expected == "REJECTED" else 0)
    case = outcome_client.get(f"/api/job/outcomes/cases/{saved['caseId']}").json()["data"]
    assert case["report"]["outcome"] == expected


@pytest.mark.parametrize(
    "proposal", ["能否安排一次面试？", "我可以参加周五面试吗？", "明天可以电话沟通吗？"]
)
@pytest.mark.parametrize("answer", ["可以", "好的", "没问题"])
def test_short_assent_to_actual_next_step_has_both_pieces_of_evidence(world, proposal, answer):
    facts = merged(observation(proposal, role="USER", stamp=NOW))
    facts = merged(
        observation(answer, event="accept", message="accept", stamp=NOW + 1000), facts, NOW + 1000
    )
    result = project(facts, world["settings"], NOW + 1000)
    assert result["outcome"] == "POSITIVE" and result["analysisKind"] == "FACTS_ONLY"
    assert [(item["role"], item["quote"]) for item in result["evidence"]] == [
        ("USER", proposal),
        ("HR", answer),
    ]


@pytest.mark.parametrize(
    "proposal",
    [
        "您好，这是我的自我介绍。",
        "我稍后发资料给您。",
        "我上次参加面试了。",
        "引用原话：能否安排面试？",
        "如果可以的话也许可以安排面试？",
    ],
)
@pytest.mark.parametrize("answer", ["好的", "收到"])
def test_courtesy_or_untrusted_context_is_not_agreement_to_advance(world, proposal, answer):
    facts = merged(observation(proposal, role="USER", stamp=NOW))
    facts = merged(
        observation(answer, event="reply", message="reply", stamp=NOW + 1000), facts, NOW + 1000
    )
    assert project(facts, world["settings"], NOW + 1000)["outcome"] == "REPLIED"


def test_short_assent_with_unknown_proposal_time_cannot_establish_order(world):
    item = observation("能否安排面试？", role="USER", stamp=NOW)
    item["messages"][0]["sentAt"] = None
    facts = merged(item)
    facts = merged(
        observation("可以", event="reply", message="reply", stamp=NOW + 1000), facts, NOW + 1000
    )
    assert project(facts, world["settings"], NOW + 1000)["outcome"] == "REPLIED"


def test_api_agreement_publishes_proposal_and_acceptance_without_rejection_model(
    outcome_client, world
):
    first = observation("能否安排面试？", role="USER")
    ingest(outcome_client, first)
    ingest(
        outcome_client,
        observation(
            "没问题", event="agreement", message="agreement", stamp=first["observedAt"] + 1000
        ),
    )
    _, saved = save(outcome_client, claim(outcome_client))
    report = outcome_client.get(f"/api/job/outcomes/cases/{saved['caseId']}").json()["data"][
        "report"
    ]
    assert report["outcome"] == "POSITIVE" and world["fake"].calls == []
    assert [item["role"] for item in report["evidence"]] == ["USER", "HR"]
