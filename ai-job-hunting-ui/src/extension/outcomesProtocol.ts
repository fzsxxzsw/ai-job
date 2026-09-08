export const OUTCOME_API_URL = 'http://127.0.0.1:9100'
export const OUTCOME_ALARM = 'job-helper-outcomes-v1'
export const OUTCOMES = ['WAITING', 'NO_REPLY', 'REPLIED', 'POSITIVE', 'REJECTED', 'UNKNOWN'] as const
export type Outcome = typeof OUTCOMES[number]
export type OutcomeMessage = {
    messageId: string; clientMessageId?: string | null; role: 'USER' | 'HR'; text: string
    sentAt: number | null; deliveryState: 'ACKNOWLEDGED' | 'UNKNOWN'
}
export type OutcomeReadEvidence = {
    messageId: string; state: 'READ' | 'UNREAD'; source: 'BOSS_EXACT_MESSAGE_STATUS'; observedAt: number
}
export type OutcomeCoverage = {
    anchorMessageId: string; latestMessageId: string; checkedAt: number; completeAfterAnchor: true
}
export type OutcomeAnchor = {
    binding: {encryptJobId: string; conversationKey: string; bossId: string; observedAt: number}
    message: OutcomeMessage; clientMid: string; serverMid: string; acceptedAt: number
}
export type OutcomeEvidence = {
    evidenceId: string; source: 'CHAT' | 'JOB' | 'RESUME'; messageId: string | null
    role: 'HR' | 'USER' | null; quote: string
}
export type OutcomeObservation = {
    eventId: string; encryptJobId: string; conversationKey: string | null; bossId: string | null
    source: 'APPLICATION_FLOW' | 'BOSS_PASSIVE_MESSAGE' | 'BOSS_SEND_ACK' | 'BOSS_CONVERSATION_SNAPSHOT' | 'BOSS_EXACT_MESSAGE_STATUS'
    observedAt: number; bindingObservedAt: number; messages: OutcomeMessage[]
    readEvidence: OutcomeReadEvidence | null; coverage: OutcomeCoverage | null
}
export type OutcomeReport = {
    reportId: string; caseId: string; revision: number; outcome: Outcome; readState: 'READ' | 'UNREAD' | 'UNKNOWN'
    waitingOn: 'HR' | 'USER' | 'NONE' | 'UNKNOWN'; asOf: number; summary: string
    analysisSource: 'RULES_ONLY' | 'RULES_AI'; feedbackStatus: string; isCurrent: boolean
    evidence: OutcomeEvidence[]
    explicitReasons: {code?: string; label?: string; reason?: string; evidenceIds?: string[]}[]
    inferredRisks: {code?: string; label?: string; reason?: string; evidenceIds?: string[]}[]
    unknowns: string[]; suggestions: string[]
}
export type OutcomeCase = {
    caseId: string; encryptJobId: string; conversationKey: string | null; bossId: string | null
    revision: number; status: string; nextCheckAt: number | null; lastObservedAt: number; report: OutcomeReport | null
    outcome: Outcome; readState: 'READ' | 'UNREAD' | 'UNKNOWN'; waitingOn: 'HR' | 'USER' | 'NONE' | 'UNKNOWN'
    task?: OutcomeTask | null
}
export function outcomeLivePresentation(item: Pick<OutcomeCase, 'outcome' | 'readState' | 'waitingOn' | 'lastObservedAt'>) {
    const outcome = OUTCOMES.includes(item.outcome) ? item.outcome : 'UNKNOWN'
    const readState = ['READ', 'UNREAD'].includes(item.readState) ? item.readState : 'UNKNOWN'
    const waiting = ({HR: '等待 HR', USER: '等待你的回应', NONE: '当前无需回复', UNKNOWN: '下一步未知'} as Record<string, string>)[item.waitingOn] || '下一步未知'
    const reading = ({READ: '对方已读', UNREAD: '对方未读', UNKNOWN: '阅读状态未知'} as Record<string, string>)[readState]
    return {label: outcomeLabel({outcome, readState}), status: `${waiting} · ${reading}`, observedAt: item.lastObservedAt}
}
export type OutcomeTask = {
    jobId: string; caseId: string; revision: number; status: string; phase: string; attempts: number
    nextAttemptAt: number | null; lastErrorCode: string | null; reportId: string | null
    createdAt: number; updatedAt: number; phaseHistory: {phase: string; at: number}[]
}
export function outcomePhaseLabel(phase: string): string {
    return ({COLLECTING: '收集事实', ANALYZING: '分析', VALIDATING: '校验证据', SAVING: '保存报告', SAVED: '报告已保存',
        WAITING_CONFIRMATION: '旧任务正在自动收尾', COMPLETED: '已完成', RETRY: '等待重试', FAILED: '处理失败',
        CONFIRMATION_READY: '反馈已保存，正在收尾', SUPERSEDED: '已由新观察替代'} as Record<string, string>)[phase] || '等待处理'
}
export function outcomeTaskLabel(task: Pick<OutcomeTask, 'status' | 'phase'>): string {
    if (task.status === 'READY' || task.status === 'QUEUED') return '等待 LangGraph 领取'
    return outcomePhaseLabel(['RETRY', 'FAILED', 'COMPLETED', 'CONFIRMATION_READY', 'SUPERSEDED'].includes(task.status) ? task.status : task.phase)
}
export function outcomeReportNotice(item: Pick<OutcomeCase, 'revision' | 'report'>): string {
    if (!item.report) return ''
    return !item.report.isCurrent || item.report.revision !== item.revision ? '上一版报告，新分析处理中' : '当前版本报告'
}
export type OutcomeFeedback = {
    requestId: string; action: 'CONFIRM' | 'CORRECT' | 'IGNORE'; correctedOutcome: Outcome | null; correctedReason: string | null
}
export type OutcomeCommand = {kind: 'session'; authorization: string; serverUrl: string; platformAccount: string}
    | {kind: 'enqueue'; scope: string; observations: OutcomeObservation[]}
    | {kind: 'status'; scope: string}
    | {kind: 'feedback'; scope: string; reportId: string; feedback: OutcomeFeedback}
export type OutcomeStatus = {
    scope: string; pending: number; blocked: number; expired: number; error: string; items: OutcomeCase[]; updatedAt: number
    anchors?: OutcomeAnchor[]
}

function record(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}
function keys(value: Record<string, any>, allowed: string[]): boolean {
    return Object.keys(value).every(key => allowed.includes(key))
}
function text(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\u0000')
}
function time(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 }

export function normalizeOutcomeObservation(value: unknown): OutcomeObservation | null {
    if (!record(value) || !keys(value, ['eventId', 'encryptJobId', 'conversationKey', 'bossId', 'source', 'observedAt', 'bindingObservedAt', 'messages', 'readEvidence', 'coverage'])
        || !text(value.eventId, 128) || !text(value.encryptJobId, 255)
        || !time(value.observedAt) || !time(value.bindingObservedAt)
        || !['APPLICATION_FLOW', 'BOSS_PASSIVE_MESSAGE', 'BOSS_SEND_ACK', 'BOSS_CONVERSATION_SNAPSHOT', 'BOSS_EXACT_MESSAGE_STATUS'].includes(value.source)
        || !Array.isArray(value.messages) || value.messages.length > 40) return null
    const application = value.source === 'APPLICATION_FLOW'
    if ((!text(value.conversationKey, 255) || !text(value.bossId, 80))
        && !(application && value.conversationKey === null && value.bossId === null)) return null
    const messages: OutcomeMessage[] = []
    for (const message of value.messages) {
        if (!record(message) || !keys(message, ['messageId', 'clientMessageId', 'role', 'text', 'sentAt', 'deliveryState'])
            || !text(message.messageId, 160) || (message.clientMessageId != null && !text(message.clientMessageId, 160))
            || !['USER', 'HR'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 4000
            || (message.sentAt !== null && !time(message.sentAt)) || !['ACKNOWLEDGED', 'UNKNOWN'].includes(message.deliveryState)) return null
        if (value.source === 'BOSS_SEND_ACK' && (message.role !== 'USER' || message.deliveryState !== 'ACKNOWLEDGED' || !message.clientMessageId)) return null
        if (message.deliveryState === 'ACKNOWLEDGED' && (message.role !== 'USER'
            || !['BOSS_SEND_ACK', 'BOSS_CONVERSATION_SNAPSHOT'].includes(value.source))) return null
        if (value.source === 'BOSS_SEND_ACK' && (message.messageId === message.clientMessageId || message.messageId.startsWith('client:'))) return null
        messages.push({messageId: message.messageId, clientMessageId: message.clientMessageId ?? null,
            role: message.role, text: message.text, sentAt: message.sentAt, deliveryState: message.deliveryState})
    }
    const read = value.readEvidence
    if (read !== null && (!record(read) || !keys(read, ['messageId', 'state', 'source', 'observedAt'])
        || !text(read.messageId, 160) || !['READ', 'UNREAD'].includes(read.state)
        || read.source !== 'BOSS_EXACT_MESSAGE_STATUS' || !time(read.observedAt))) return null
    const coverage = value.coverage
    if (coverage !== null && (value.source !== 'BOSS_CONVERSATION_SNAPSHOT' || !record(coverage)
        || !keys(coverage, ['anchorMessageId', 'latestMessageId', 'checkedAt', 'completeAfterAnchor'])
        || !text(coverage.anchorMessageId, 160) || !text(coverage.latestMessageId, 160)
        || !time(coverage.checkedAt) || coverage.completeAfterAnchor !== true)) return null
    if (application && (messages.length || read || coverage)) return null
    if (!application && !messages.length && !read && !coverage) return null
    if (value.source === 'BOSS_SEND_ACK' && !messages.length) return null
    return {eventId: value.eventId, encryptJobId: value.encryptJobId, conversationKey: value.conversationKey,
        bossId: value.bossId, source: value.source, observedAt: value.observedAt, bindingObservedAt: value.bindingObservedAt,
        messages, readEvidence: read ? {...read} as OutcomeReadEvidence : null, coverage: coverage ? {...coverage} as OutcomeCoverage : null}
}

export function normalizeOutcomeCommand(value: unknown): OutcomeCommand | null {
    if (!record(value)) return null
    if (value.kind === 'session') {
        return keys(value, ['kind', 'authorization', 'serverUrl', 'platformAccount'])
            && typeof value.authorization === 'string' && value.authorization.length <= 4096 && !/[\r\n]/.test(value.authorization)
            && typeof value.serverUrl === 'string' && value.serverUrl.length <= 255
            && typeof value.platformAccount === 'string' && value.platformAccount.length <= 80
            ? {kind: 'session', authorization: value.authorization, serverUrl: value.serverUrl, platformAccount: value.platformAccount} : null
    }
    if (!text(value.scope, 128)) return null
    if (value.kind === 'status') return keys(value, ['kind', 'scope']) ? {kind: 'status', scope: value.scope} : null
    if (value.kind === 'enqueue' && keys(value, ['kind', 'scope', 'observations']) && Array.isArray(value.observations)
        && value.observations.length > 0 && value.observations.length <= 32) {
        const observations = value.observations.map(normalizeOutcomeObservation)
        return observations.every(Boolean) ? {kind: 'enqueue', scope: value.scope, observations: observations as OutcomeObservation[]} : null
    }
    const feedback = value.feedback
    if (value.kind === 'feedback' && keys(value, ['kind', 'scope', 'reportId', 'feedback']) && text(value.reportId, 160)
        && record(feedback) && keys(feedback, ['requestId', 'action', 'correctedOutcome', 'correctedReason'])
        && text(feedback.requestId, 128) && ['CONFIRM', 'CORRECT', 'IGNORE'].includes(feedback.action)
        && (feedback.correctedOutcome === null || OUTCOMES.includes(feedback.correctedOutcome))
        && (feedback.correctedReason === null || (typeof feedback.correctedReason === 'string' && feedback.correctedReason.length <= 1000))
        && (feedback.action !== 'CORRECT' || feedback.correctedReason?.trim())) {
        return {kind: 'feedback', scope: value.scope, reportId: value.reportId, feedback: {...feedback} as OutcomeFeedback}
    }
    return null
}

export function outcomeLabel(report: Pick<OutcomeReport, 'outcome' | 'readState'>): string {
    if (report.outcome === 'NO_REPLY') return report.readState === 'READ' ? '已读不回' : report.readState === 'UNREAD' ? '未读不回' : '未回复（阅读状态未知）'
    return {WAITING: '等待回应', REPLIED: 'HR 已回复', POSITIVE: '积极回应', REJECTED: 'HR 已拒绝', UNKNOWN: '信息不足'}[report.outcome]
}
