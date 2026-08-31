export type JobTitleMatchMode = 'off' | 'prefer' | 'required'

export type JobTitleRuleDecision = {
    status: 'PASS' | 'SKIP' | 'ADVISORY'
    reason: string
    matchedKeywords: string[]
}

export type JobTitleRuleInput = {
    jobName: string
    postDescription?: string
    includeKeywords?: string[]
    excludeKeywords?: string[]
    mode?: JobTitleMatchMode
}

// These words are useful search hints, but are too broad to prove that a role
// is a software job by themselves. They need technical evidence in the title
// or JD before a rules-only run may contact the recruiter.
const WEAK_TECHNICAL_KEYWORDS = new Set([
    'ai',
    '开发',
    '研发',
    '算法',
    '工程师',
    '技术',
])

const CLEAR_NON_TECHNICAL_TITLE = /(?:主播|直播带货|美妆|调解|催收|销售|客服|招聘|人事|行政|文员|商务拓展|渠道拓展|课程顾问|电话邀约|市场开发|业务开发|客户开发|产品经理|产品运营)/i

const TECHNICAL_TITLE_EVIDENCE = /(?:全栈|前端|后端|软件(?:开发)?|程序员|测试开发|客户端开发|服务端开发|数据开发|大数据|机器学习|深度学习|算法工程师|python|java|golang|go语言|c\+\+|\.net|php|node(?:\.js)?|web开发|移动端|android|ios|嵌入式|架构师|devops|运维开发|ai应用|aigc|agent|智能体)/i

const JD_TECHNICAL_EVIDENCE = [
    /(?:编程|编码|代码|软件开发|系统开发|接口开发|技术架构)/i,
    /(?:python|java|golang|go语言|c\+\+|javascript|typescript|vue|react|spring|django|flask|node(?:\.js)?)/i,
    /(?:mysql|postgresql|redis|mongodb|数据库|消息队列|linux|docker|kubernetes|k8s)/i,
    /(?:算法|机器学习|深度学习|大模型|llm|aigc|agent|智能体)/i,
]

function normalize(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .toLowerCase()
}

function normalizedKeywords(keywords: string[] | undefined): string[] {
    return Array.from(new Set((keywords || []).map(normalize).filter(Boolean)))
}

function matchingKeywords(text: string, keywords: string[]): string[] {
    return keywords.filter(keyword => text.includes(keyword))
}

function jdTechnicalEvidenceCount(postDescription: string): number {
    return JD_TECHNICAL_EVIDENCE.reduce(
        (count, pattern) => count + (pattern.test(postDescription) ? 1 : 0),
        0,
    )
}

/**
 * Deterministic title gate for rules-only applications.
 *
 * User exclusions always win. Strong configured keywords are sufficient on
 * their own; broad keywords such as “开发” or “AI” require additional technical
 * evidence. In required mode an unproven role is skipped instead of being sent
 * to AI or silently allowed.
 */
export function evaluateJobTitleRule(input: JobTitleRuleInput): JobTitleRuleDecision {
    const mode = input.mode || 'off'
    const jobName = normalize(input.jobName)
    const postDescription = normalize(input.postDescription)
    const includeKeywords = normalizedKeywords(input.includeKeywords)
    const excludeKeywords = normalizedKeywords(input.excludeKeywords)

    const excluded = matchingKeywords(jobName, excludeKeywords)
    if (excluded.length > 0) {
        return {
            status: 'SKIP',
            reason: `岗位名命中排除词：${excluded.join('、')}`,
            matchedKeywords: excluded,
        }
    }

    if (mode === 'off') {
        return {status: 'PASS', reason: '岗位名规则已关闭', matchedKeywords: []}
    }

    if (!jobName) {
        return mode === 'required'
            ? {status: 'SKIP', reason: '岗位名称为空，无法验证是否属于目标技术岗位', matchedKeywords: []}
            : {status: 'ADVISORY', reason: '岗位名称为空，无法计算岗位名偏好', matchedKeywords: []}
    }

    if (includeKeywords.length === 0) {
        return mode === 'required'
            ? {status: 'SKIP', reason: '尚未配置目标岗位关键词', matchedKeywords: []}
            : {status: 'ADVISORY', reason: '尚未配置目标岗位关键词', matchedKeywords: []}
    }

    const included = matchingKeywords(jobName, includeKeywords)
    // Explicit non-technical semantics outrank incidental technology words.
    // “Java课程顾问” and “AI产品运营” must not pass only because one token
    // happens to look technical.
    if (CLEAR_NON_TECHNICAL_TITLE.test(jobName)) {
        return {
            status: mode === 'required' ? 'SKIP' : 'ADVISORY',
            reason: '岗位名称明确属于非技术方向',
            matchedKeywords: included,
        }
    }

    const strongMatches = included.filter(keyword => !WEAK_TECHNICAL_KEYWORDS.has(keyword))
    if (strongMatches.length > 0) {
        return {
            status: 'PASS',
            reason: `岗位名命中目标技术词：${strongMatches.join('、')}`,
            matchedKeywords: strongMatches,
        }
    }

    const hasTechnicalEvidence = TECHNICAL_TITLE_EVIDENCE.test(jobName)
        || jdTechnicalEvidenceCount(postDescription) >= 2
    if (included.length > 0 && hasTechnicalEvidence) {
        return {
            status: 'PASS',
            reason: `岗位名命中宽泛词且JD包含技术证据：${included.join('、')}`,
            matchedKeywords: included,
        }
    }

    return {
        status: mode === 'required' ? 'SKIP' : 'ADVISORY',
        reason: included.length > 0
            ? `岗位名只命中宽泛词“${included.join('、')}”，缺少软件技术证据`
            : '岗位名未命中任何目标技术关键词',
        matchedKeywords: included,
    }
}
