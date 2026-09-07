"""Shared conservative context gate for HR facts, before clause/quote extraction."""

import re

NON_ASSERTIVE = re.compile(
    r"[?？]|(?:吗|么|呢)(?:[。！!\s]*$)|请问|是否|能否|可否|是不是|会不会|难道"
    r"|如果|假如|倘若|要是|假设|若(?:是|有|因|不|未|没|超|经验|薪资|学历)"
    r"|忽略|无视.{0,16}(?:规则|指令|上文|前面)|扮演|系统指令|系统提示"
    r"|(?:输出|返回|生成|写成|标记|认定|归类|解释为).{0,30}(?:JSON|findings|code|薪资|学历|岗位|经验|拒绝|原因|结论)"
    r"|(?:将|把).{0,30}(?:判定|归类|标记|设为|改为|填成|写成)",
    re.I,
)


def is_assertive_context(text: str) -> bool:
    """Use the whole message: splitting must not discard a preceding command or 'if'.

    Mixed questions/statements in one message are deliberately left for a person to
    interpret. Other independently assertive HR messages remain usable evidence.
    """
    return not bool(NON_ASSERTIVE.search(text))
