"""Conservative evidence rules, ported from the existing Java rejection experiment."""
import json
import re

PROMPT_VERSION = 'rejection-python-v1'
TAXONOMY_VERSION = 'rejection-taxonomy-v1'
PATTERNS = {
    'POSITION_CLOSED': (r'(?:职位|岗位|招聘|HC|名额).{0,12}(?:关闭|暂停|取消|冻结|已满|招满)|(?:已经|目前|暂时)?(?:已)?招满了?', '职位已关闭或招满'),
    'EDUCATION_EXPLICIT': (r'(?:学历|本科|硕士|研究生|博士|学校|院校).{0,12}(?:不符|不合适|不匹配|达不到|未达到)|(?:不符|不合适|不匹配|未达到).{0,12}(?:学历|学校|院校)', '学历或院校硬条件'),
    'LEVEL_MISMATCH': (r'(?:经验|年限|级别).{0,12}(?:不符|不合适|不匹配|不足|未达到)|(?:不符|不合适|不匹配|不足|未达到).{0,12}(?:经验|年限|级别)', '经验或岗位级别不匹配'),
    'INDUSTRY_DOMAIN': (r'(?:必须|需要|要求|至少|具备)[^。；;\n]{0,28}(?:TMS|运输管理系统|物流|供应链)|(?:TMS|运输管理系统|物流|供应链)[^。；;\n]{0,28}(?:必须|需要|要求|不符|不匹配|不足|没有)', '行业经验要求'),
}
ALLOWED_CODES = set(PATTERNS) | {'MANAGEMENT_REQUIRED', 'SKILL_STACK', 'SALARY',
    'LOCATION', 'AVAILABILITY', 'GENERIC_REJECTION', 'UNKNOWN', 'USER_CORRECTION'}


def strip_private_fields(value, depth=0):
    if depth > 12: return '[深层字段已省略]'
    if isinstance(value, list): return [strip_private_fields(v, depth+1) for v in value]
    if not isinstance(value, dict): return value
    result = {}
    for key, child in value.items():
        name = re.sub(r'[^a-z0-9]', '', str(key).lower())
        if name.endswith(('id','token','key','secret','password','url','avatar','logo','phone','email')):
            continue
        result[key] = strip_private_fields(child, depth+1)
    return result


def redact(value: str) -> str:
    try:
        parsed = json.loads(value)
        if isinstance(parsed, (dict, list)):
            value = json.dumps(strip_private_fields(parsed), ensure_ascii=False)
    except (ValueError, TypeError, RecursionError):
        pass
    value = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[邮箱已隐藏]', value)
    value = re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)', '[电话已隐藏]', value)
    value = re.sub(r'(?i)(?:bearer\s+|sk-)[A-Za-z0-9._-]{8,}', '[密钥已隐藏]', value)
    return value.replace('\x00', '').strip()


def finding(code, label, classification, reason, ids):
    return dict(code=code, label=label, classification=classification, reason=reason, evidenceIds=ids)


def affirmed(pattern: str, value: str) -> bool:
    for match in re.finditer(pattern, value, re.I):
        before = re.split(r'[，。；;\n]', value[max(0, match.start()-24):match.start()])[-1]
        after = value[match.end():match.end()+14]
        if re.search(r'不是|并非|并不是|不因|无关|排除|否认', before + match.group()):
            continue
        if re.search(r'(?:如果|假如|倘若|要是|若)[^，。；;\n]{0,16}$', before):
            continue
        if re.search(r'^[^。；;\n]{0,10}(?:不是原因|并非原因|无关|已排除)', after):
            continue
        return True
    return False


def max_years(value):
    patterns = [r'(?<!\d)(\d{1,2})\s*年(?:以上|及以上)?[^。；;\n]{0,16}(?:工作|开发|相关)?经验',
                r'(?:工作|开发|相关)?经验[^。；;\n]{0,12}(?:至少|要求|约|近)?\s*(\d{1,2})\s*年']
    years = [int(m) for pattern in patterns for m in re.findall(pattern, value)]
    return max((n for n in years if n <= 30), default=-1)


def analyze_rules(evidence):
    explicit, inferred = {}, {}
    for item in evidence:
        if item['source'] != 'HR_DIALOGUE': continue
        for code, (pattern, label) in PATTERNS.items():
            if affirmed(pattern, item['text']):
                explicit.setdefault(code, finding(code, label, 'EXPLICIT', 'HR原话明确提及：' + label, [item['id']]))
    jd = [e for e in evidence if e['id'].startswith('J')]
    resume = next((e for e in evidence if e['id'].startswith('R')), None)
    if jd and resume:
        most = max(jd, key=lambda e: max_years(e['text']))
        years, actual = max_years(most['text']), max_years(resume['text'])
        if years >= 5 and actual >= 0 and years - actual >= 3:
            inferred['LEVEL_MISMATCH'] = finding('LEVEL_MISMATCH', '经验年限可能有差距', 'INFERRED',
                f'岗位文字出现约{years}年经验要求，简历文字出现约{actual}年经验；需人工核对，并非已证实的拒绝原因', [most['id'], resume['id']])
        for item in jd:
            if affirmed(PATTERNS['INDUSTRY_DOMAIN'][0], item['text']) and not re.search(r'TMS|运输管理系统|物流|供应链', resume['text'], re.I):
                inferred['INDUSTRY_DOMAIN'] = finding('INDUSTRY_DOMAIN', '行业经验证据不足', 'INFERRED',
                    '岗位要求相关行业经验，投递时简历快照未找到对应证据；不代表实际没有经验', [item['id'], resume['id']])
            if affirmed(r'管理经验|带领团队|团队管理', item['text']) and not re.search(r'管理|带队|带领团队', resume['text']):
                inferred['MANAGEMENT_REQUIRED'] = finding('MANAGEMENT_REQUIRED', '管理经验证据不足', 'INFERRED',
                    '岗位要求管理或带队经验，简历快照未找到对应证据', [item['id'], resume['id']])
    unknowns = ['当前页对话可能不完整；推断不代表招聘方真实动机']
    if not explicit: unknowns.append('HR没有明确说明可核验的具体拒绝原因')
    if not jd or not resume: unknowns.append('缺少投递时的岗位或简历快照，仅分析HR明确表达，不补造历史资料')
    if not inferred: unknowns.append('现有岗位与简历证据不足以定位主要差距')
    suggestions = ['不因本次拒绝修改简历事实；调整投递条件前请人工确认']
    if 'POSITION_CLOSED' in explicit: suggestions.append('岗位关闭或招满属于不可控因素，不要据此否定个人能力')
    if 'LEVEL_MISMATCH' in explicit or 'LEVEL_MISMATCH' in inferred: suggestions.append('核对岗位年限要求与简历中已写明的经验，优先考虑相匹配岗位')
    return dict(explicitReasons=list(explicit.values()), inferredRisks=list(inferred.values()),
                unknowns=unknowns, suggestions=suggestions, evidence=evidence)


def validate_ai(answer: str, evidence):
    try:
        obj = json.loads(answer)
    except (ValueError, TypeError):
        return False
    if not isinstance(obj, dict) or set(obj) != {'findings'} or not isinstance(obj['findings'], list) or len(obj['findings']) > 12:
        return False
    allowed = {e['id']: e for e in evidence}
    accepted = False
    for value in obj['findings']:
        if not isinstance(value, dict) or set(value) != {'code','label','classification','reason','evidenceIds'}: continue
        if not all(isinstance(value[k], str) for k in ('code','label','classification','reason')): continue
        ids = value['evidenceIds']
        if not isinstance(ids,list) or not 1 <= len(ids) <= 8 or not all(isinstance(i,str) and i in allowed for i in ids): continue
        kind = value['classification']
        key = 'explicitReasons' if kind == 'EXPLICIT' else 'inferredRisks' if kind == 'INFERRED' else None
        if not key: continue
        if kind == 'EXPLICIT' and not all(allowed[i]['source']=='HR_DIALOGUE' for i in ids): continue
        if kind == 'INFERRED' and not (any(i.startswith('J') for i in ids) and any(i.startswith('R') for i in ids)): continue
        supported = analyze_rules([allowed[i] for i in ids])[key]
        if not any(f['code']==value['code'] for f in supported): continue
        grounded = set(re.findall(r'\d+(?:\.\d+)?', '\n'.join(allowed[i]['text'] for i in ids)))
        if not set(re.findall(r'\d+(?:\.\d+)?', value['reason'])) <= grounded: continue
        accepted = True
    # Keep independently validated rule wording, not unverified model prose.
    return accepted
