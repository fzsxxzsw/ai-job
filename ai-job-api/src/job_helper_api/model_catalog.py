"""Provider model IDs, capabilities and request adaptations; never account balances."""

import re

SCREENSHOT_MODELS = """
qwen3.5-omni-plus-2026-03-15
qwen3-omni-flash-realtime-2025-09-15
qwen3-omni-flash-realtime
qwen-omni-turbo-realtime-2025-05-08
qwen-omni-turbo-realtime-latest
qwen3.5-omni-flash-realtime-2026-03-15
qwen3-omni-flash-2025-12-01
qwen3-omni-flash
qwen3.5-omni-plus
qwen-omni-turbo-realtime
qwen-omni-turbo-latest
qwen-omni-turbo
qwen2.5-omni-7b
qwen3.5-omni-plus-realtime
qwen-omni-turbo-2025-03-26
qwen3.5-omni-flash
qwen3-omni-flash-realtime-2025-12-01
qwen-omni-turbo-2025-01-19
qwen3.5-omni-plus-realtime-2026-03-15
qwen3.5-omni-flash-realtime
qwen3-omni-flash-2025-09-15
qwen3.5-omni-flash-2026-03-15
qwen-math-turbo
qwen3-vl-235b-a22b-thinking
qwen3-vl-32b-thinking
qwen-plus-2025-07-28
deepseek-r1-distill-qwen-7b
glm-5
qwen-max
qwen-mt-flash
qwen3-vl-30b-a3b-thinking
qwen-vl-ocr-latest
qwen3-32b
deepseek-r1-distill-qwen-32b
qwen-vl-plus
qwen-long
qwen3.5-35b-a3b
glm-4.5-air
qwen3-coder-480b-a35b-instruct
qwen3-coder-plus
qwen3-vl-8b-thinking
deepseek-v4-flash-0731
qwen3-max-preview
qwen-vl-ocr-1028
qwen3-vl-flash-2025-10-15
qwen3-8b
qwen-plus-0112
qwen-math-plus
gui-plus
qwen-turbo
qvq-max
qwen3-coder-flash
qwen3-next-80b-a3b-thinking
qwen3.5-27b
tongyi-xiaomi-analysis-flash
deepseek-r1
qwen3-vl-flash
qwen-math-plus-0919
qwen3-14b
MiniMax-M2.5
qwen3-max-2025-09-23
qwen-plus-2025-12-01
qwen3-max-2026-01-23
""".split()

TASKS = {
    "filter": "岗位筛选",
    "greeting": "招呼语",
    "conversation": "对话回复",
    "analysis": "复杂分析",
}


def model_info(name):
    lower = name.lower()
    protocol, category, reason = "chat", "通用文本", ""
    tasks = list(TASKS)
    if "realtime" in lower:
        protocol, category, reason = (
            "realtime",
            "实时语音",
            "使用实时音频接口；当前求职任务没有实时音频输入",
        )
    elif "ocr" in lower or lower == "gui-plus":
        category, reason = "图像专用", "需要图像或专用结构输入，不参加当前文本任务的自动分配"
    elif "qwen-mt" in lower or "math" in lower or "xiaomi" in lower:
        category, reason = "专项模型", "翻译、数学或专项分析模型，不参加通用求职任务的自动分配"
    elif "omni" in lower:
        protocol, category = "chat-stream", "全模态（文本模式）"
    elif "coder" in lower:
        category, tasks = "代码分析", ["analysis"]
    elif "-vl" in lower or "qvq" in lower:
        category = "视觉与文本"
    elif not re.match(r"^(qwen|deepseek|glm|MiniMax)-?", name, re.I):
        reason = "待确认模型接口和能力，暂不参加自动分配"
    if reason:
        tasks = []
    return {
        "id": name,
        "category": category,
        "protocol": protocol,
        "supportedTasks": tasks,
        "note": reason,
    }


def thinking_options(name, mode, budget):
    lower = name.lower()
    # Do not send Qwen-only parameters to legacy, code, OCR or third-party models.
    if lower.startswith(("qwen3", "qwen2.5-omni")) and not any(
        x in lower for x in ("coder", "ocr", "realtime")
    ):
        enabled = "thinking" in lower or mode == "on"
        result = {"enable_thinking": enabled}
        if enabled:
            result["thinking_budget"] = budget
        return result
    return {}


def catalog():
    return [model_info(name) for name in SCREENSHOT_MODELS]
