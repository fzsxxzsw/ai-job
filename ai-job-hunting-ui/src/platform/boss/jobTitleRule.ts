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
    'ai应用',
    'aigc',
    '人工智能',
    '大模型',
    'agent',
    '智能体',
    '开发',
    '研发',
    '算法',
    '工程师',
    '技术',
])

const CLEAR_NON_TECHNICAL_TITLE = /(?:主播|直播带货|美妆|调解|催收|销售|客服|招聘|人事|行政|文员|商务拓展|渠道拓展|课程顾问|实施顾问|技术支持|售前|售后|客户成功|培训师|电话邀约|市场开发|业务开发|客户开发|产品经理|(?:产品|内容|直播|新媒体)运营|运营(?:经理|主管|专员|总监|助理|实习|策划|岗)|短视频(?:剪辑|制作|拍摄|运营|编导|策划|创作|(?:ai|aigc)工程师)|视频(?:制作|剪辑)|剪辑|编导|导演|摄像师|摄影师|影视后期|后期制作|特效制作|内容创作|视觉设计师|平面设计师)/i

const TECHNICAL_TITLE_EVIDENCE = /(?:全栈|前端|后端|软件(?:开发|工程师|测试)|程序员|测试开发|客户端开发|服务端开发|(?:平台|系统|应用|数据)开发|大数据(?:开发|工程师)|机器学习(?:开发|工程师)|深度学习(?:开发|工程师)|算法工程师|web开发|移动端开发|嵌入式(?:开发|工程师)|(?:软件|系统|技术|云|数据|ai)架构师|devops|运维开发|(?:python|java|golang|go语言|c\+\+|\.net|php|node(?:\.js)?|android|ios|区块链|ai应用|aigc|agent|智能体|人工智能|大模型).{0,8}(?:开发|研发|算法工程师|软件工程师|工程师)|(?:开发|研发).{0,8}(?:ai应用|agent|智能体|大模型))/i

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

function jdCodeEvidenceCount(postDescription: string): number {
    return JD_TECHNICAL_EVIDENCE.slice(0, 3).reduce(
        (count, pattern) => count + (pattern.test(postDescription) ? 1 : 0),
        0,
    )
}

export function isClearlyNonDeveloperTitle(jobName: string): boolean {
    return CLEAR_NON_TECHNICAL_TITLE.test(normalize(jobName))
}

export function hasPotentialDeveloperTitle(jobName: string): boolean {
    const normalized = normalize(jobName)
    return TECHNICAL_TITLE_EVIDENCE.test(normalized)
        || /(?:开发|研发|工程师|算法专家)/.test(normalized)
}

function hasDeveloperEvidence(jobName: string, postDescription: string): boolean {
    if (TECHNICAL_TITLE_EVIDENCE.test(jobName)) return true
    // A generic “engineer/development” title needs concrete coding evidence.
    // AI, AIGC, Agent and algorithms alone can describe content-production work.
    return hasPotentialDeveloperTitle(jobName)
        && jdCodeEvidenceCount(postDescription) >= 2
}

/**
 * Deterministic title gate for rules-only applications.
 *
 * User exclusions and the developer-role safety floor always apply. Configured
 * keywords further narrow required-mode applications; turning off keywords does
 * not authorize contacting clearly unrelated roles.
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

    if (!jobName) {
        return {status: 'SKIP', reason: '岗位名称为空，无法验证是否属于开发岗位', matchedKeywords: []}
    }
    const included = matchingKeywords(jobName, includeKeywords)
    // Explicit non-technical semantics outrank incidental technology words.
    // “Java课程顾问” and “AI产品运营” must not pass only because one token
    // happens to look technical.
    if (isClearlyNonDeveloperTitle(jobName)) {
        return {
            status: 'SKIP',
            reason: '岗位名称明确属于非技术方向',
            matchedKeywords: included,
        }
    }

    if (!hasDeveloperEvidence(jobName, postDescription)) {
        return {
            status: 'SKIP',
            reason: '岗位名称和职责缺少软件开发证据',
            matchedKeywords: included,
        }
    }

    if (mode === 'off') {
        return {status: 'PASS', reason: '已确认属于开发岗位；目标关键词限制已关闭', matchedKeywords: []}
    }

    if (includeKeywords.length === 0) {
        return mode === 'required'
            ? {status: 'SKIP', reason: '尚未配置目标岗位关键词', matchedKeywords: []}
            : {status: 'ADVISORY', reason: '尚未配置目标岗位关键词', matchedKeywords: []}
    }

    const strongMatches = included.filter(keyword => !WEAK_TECHNICAL_KEYWORDS.has(keyword))
    if (strongMatches.length > 0) {
        return {
            status: 'PASS',
            reason: `岗位名命中目标技术词：${strongMatches.join('、')}`,
            matchedKeywords: strongMatches,
        }
    }

    const hasTechnicalEvidence = hasDeveloperEvidence(jobName, postDescription)
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
