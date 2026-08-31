export type AiDecisionStatus = 'MATCH' | 'REJECT' | 'UNKNOWN'

export interface AiJobDecision {
    status: AiDecisionStatus
    filter: boolean
    reason: string
    score?: number
    engine?: 'LOCAL_RULES' | 'AI' | string
    matchedStrengths?: string[]
    gaps?: string[]
    titleScore?: number
    skillScore?: number
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | string
    evidenceCount?: number
    cacheable: boolean
}

const STATUS_VALUES = new Set<AiDecisionStatus>(['MATCH', 'REJECT', 'UNKNOWN'])

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

/**
 * Converts both the new tri-state response and the old `filter` response into
 * one fail-closed decision. UNKNOWN is deliberately non-cacheable so a later
 * run can retry a transient AI/backend failure.
 */
export function normalizeAiJobDecision(value: unknown): AiJobDecision {
    const record = asRecord(value)
    const statusValue = typeof record?.decisionStatus === 'string'
        ? record.decisionStatus
        : typeof record?.status === 'string' ? record.status : undefined
    const explicitStatus = statusValue
        ? statusValue.trim().toUpperCase() as AiDecisionStatus
        : undefined
    const status = explicitStatus && STATUS_VALUES.has(explicitStatus)
        ? explicitStatus
        : typeof record?.filter === 'boolean'
            ? (record.filter ? 'REJECT' : 'MATCH')
            : 'UNKNOWN'
    const reason = typeof record?.reason === 'string' && record.reason.trim()
        ? record.reason.trim()
        : status === 'UNKNOWN'
            ? 'AI 未返回可验证的岗位决策，需要人工确认'
            : status === 'REJECT'
                ? '岗位未通过 AI 条件校验'
                : '岗位已通过 AI 条件校验'
    const numericScore = typeof record?.score === 'number' && Number.isFinite(record.score)
        ? Math.max(0, Math.min(100, record.score))
        : undefined
    const engine = typeof record?.engine === 'string' ? record.engine.trim() : undefined
    const matchedStrengths = Array.isArray(record?.matchedStrengths)
        ? record.matchedStrengths.filter((item): item is string => typeof item === 'string')
        : undefined
    const gaps = Array.isArray(record?.gaps)
        ? record.gaps.filter((item): item is string => typeof item === 'string')
        : undefined
    const titleScore = finiteScore(record?.titleScore)
    const skillScore = finiteScore(record?.skillScore)
    const confidence = typeof record?.confidence === 'string' ? record.confidence.trim() : undefined
    const evidenceCount = typeof record?.evidenceCount === 'number' && Number.isFinite(record.evidenceCount)
        ? Math.max(0, Math.floor(record.evidenceCount)) : undefined

    return {
        status,
        // 保留旧字段语义；UNKNOWN 对旧逻辑也必须表现为“不要自动继续”。
        filter: status !== 'MATCH',
        reason,
        ...(numericScore === undefined ? {} : {score: numericScore}),
        ...(engine ? {engine} : {}),
        ...(matchedStrengths ? {matchedStrengths} : {}),
        ...(gaps ? {gaps} : {}),
        ...(titleScore === undefined ? {} : {titleScore}),
        ...(skillScore === undefined ? {} : {skillScore}),
        ...(confidence ? {confidence} : {}),
        ...(evidenceCount === undefined ? {} : {evidenceCount}),
        cacheable: status !== 'UNKNOWN',
    }
}

function finiteScore(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value)) : undefined
}
