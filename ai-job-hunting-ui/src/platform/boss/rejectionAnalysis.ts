import {
    classifyRejectionDebugError,
    recordRejectionDebugEvent,
} from './rejectionDebug.ts'

export const REJECTION_MESSAGE_LIMIT = 12
export const REJECTION_CONVERSATION_COMPLETENESS = 'POSSIBLY_INCOMPLETE' as const

export type RejectionMessageRole = 'HR' | 'USER'
export type RejectionClassification = 'EXPLICIT' | 'INFERRED' | 'UNKNOWN'
export type RejectionFeedbackAction = 'CONFIRM' | 'CORRECT' | 'IGNORE'

export interface RejectionMessage {
    messageId?: string
    role: RejectionMessageRole
    text: string
    timestamp?: number
}

export interface BufferedRejectionMessageInput extends RejectionMessage {
    mid?: string | number
    cmid?: string | number
}

export interface ApplicationSnapshotPayload {
    encryptJobId: string
    appliedAt: number
    jobBaseInfo: string
    jobExtInfo: string
    preMatchResult: unknown
}

export interface ApplicationSnapshotVO {
    id: number
    encryptJobId: string
    appliedAt: number
    resumeRecordId?: number
    resumeHash?: string
    jdHash?: string
    createdAt?: number
}

export interface RejectionAnalyzePayload {
    encryptJobId: string
    conversationKey: string
    completeness: typeof REJECTION_CONVERSATION_COMPLETENESS
    messages: RejectionMessage[]
}

export interface RejectionFeedbackPayload {
    action: RejectionFeedbackAction
    correctedReason?: string
    correctedCode?: string
}

export interface RejectionFinding {
    code: string
    label: string
    classification: RejectionClassification
    reason: string
    evidenceIds: string[]
}

export interface RejectionEvidence {
    id: string
    source: string
    text: string
}

export interface RejectionAnalysisVO {
    id: number
    applicationSnapshotId?: number
    status: string
    analysisSource?: string
    conversationCompleteness?: string
    explicitReasons: RejectionFinding[]
    inferredRisks: RejectionFinding[]
    unknowns: string[]
    evidence: RejectionEvidence[]
    suggestions: string[]
    model?: string
    promptVersion?: string
    createdAt?: number
    correctedReason?: string
}

export interface RejectionSummary {
    visible: boolean
    totalConfirmed: number
    categoryCounts: Record<string, number>
}

export type Snapshot = ApplicationSnapshotPayload
export type Analyze = RejectionAnalyzePayload
export type Finding = RejectionFinding
export type Evidence = RejectionEvidence
export type VO = RejectionAnalysisVO
export type Summary = RejectionSummary

type BufferedEntry = {
    message: RejectionMessage
    protocolIds: string[]
}

const messageBuffers = new Map<string, BufferedEntry[]>()

function normalizeBufferKey(value: string | number): string {
    return String(value ?? '').trim()
}

function normalizeProtocolId(value: unknown): string {
    const normalized = String(value ?? '').trim()
    return normalized && normalized !== '0' ? normalized.slice(0, 160) : ''
}

function normalizeTimestamp(value: unknown): number | undefined {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined
    return timestamp < 1_000_000_000_000 ? Math.floor(timestamp * 1000) : Math.floor(timestamp)
}

function normalizeMessage(input: RejectionMessage): RejectionMessage | null {
    const text = String(input?.text ?? '').replace(/\u0000/g, '').trim().slice(0, 4000)
    if (!text || (input?.role !== 'HR' && input?.role !== 'USER')) return null
    const messageId = normalizeProtocolId(input.messageId)
    const timestamp = normalizeTimestamp(input.timestamp)
    return {
        ...(messageId ? {messageId} : {}),
        role: input.role,
        text,
        ...(timestamp ? {timestamp} : {}),
    }
}

/**
 * Adds one protocol message to a process-memory-only ring buffer. No browser
 * storage or network primitive is used here; upload remains an explicit click.
 */
export function appendRejectionMessage(
    peerOrConversationKey: string | number,
    input: BufferedRejectionMessageInput,
): void {
    const bufferKey = normalizeBufferKey(peerOrConversationKey)
    const message = normalizeMessage(input)
    if (!bufferKey || !message) {
        recordRejectionDebugEvent('MESSAGE_BUFFER', 'SKIPPED')
        return
    }

    const protocolIds = Array.from(new Set([
        normalizeProtocolId(input.mid),
        normalizeProtocolId(input.cmid),
        normalizeProtocolId(input.messageId),
    ].filter(Boolean)))
    if (!message.messageId && protocolIds.length > 0) message.messageId = protocolIds[0]

    const entries = messageBuffers.get(bufferKey) || []
    const duplicate = protocolIds.length > 0
        ? entries.find(entry => entry.protocolIds.some(id => protocolIds.includes(id)))
        : undefined
    if (duplicate) {
        duplicate.protocolIds = Array.from(new Set([...duplicate.protocolIds, ...protocolIds]))
        if (protocolIds[0]) duplicate.message.messageId = protocolIds[0]
        if (message.timestamp) duplicate.message.timestamp = message.timestamp
        recordRejectionDebugEvent('MESSAGE_BUFFER', 'DUPLICATE', {bufferSize: entries.length})
        return
    }

    entries.push({message, protocolIds})
    if (entries.length > REJECTION_MESSAGE_LIMIT) {
        entries.splice(0, entries.length - REJECTION_MESSAGE_LIMIT)
    }
    messageBuffers.set(bufferKey, entries)
    recordRejectionDebugEvent('MESSAGE_BUFFER', 'SUCCEEDED', {bufferSize: entries.length})
}

export function readRejectionMessages(peerOrConversationKey: string | number): RejectionMessage[] {
    const entries = messageBuffers.get(normalizeBufferKey(peerOrConversationKey)) || []
    return entries.map(entry => ({...entry.message}))
}

/**
 * Prefer the conversation-scoped buffer. The recruiter-scoped buffer only
 * exists as a compatibility fallback for packets received before contact
 * metadata was available; mixing both could leak another job's messages into
 * the current rejection analysis.
 */
export function readConversationRejectionMessages(
    conversationKey: string,
    recruiterId: string | number,
): RejectionMessage[] {
    const normalizedConversationKey = normalizeBufferKey(conversationKey)
    if (normalizedConversationKey) return readRejectionMessages(normalizedConversationKey)
    return readRejectionMessages(recruiterId)
}

/** Test/logout helper. The buffer deliberately has no persistence counterpart. */
export function clearRejectionMessageBuffers(): void {
    messageBuffers.clear()
}

function semanticMessageKey(message: RejectionMessage): string {
    return `${message.role}\u0001${message.text}`
}

export function mergeRejectionMessages(...groups: RejectionMessage[][]): RejectionMessage[] {
    const merged: RejectionMessage[] = []
    const protocolIds = new Set<string>()
    const semanticKeys = new Set<string>()
    for (const input of groups.flat()) {
        const message = normalizeMessage(input)
        if (!message) continue
        const messageId = normalizeProtocolId(message.messageId)
        const semanticKey = semanticMessageKey(message)
        if ((messageId && protocolIds.has(messageId)) || semanticKeys.has(semanticKey)) continue
        if (messageId) protocolIds.add(messageId)
        semanticKeys.add(semanticKey)
        merged.push(message)
    }
    return merged.slice(-REJECTION_MESSAGE_LIMIT)
}

function rejectionDomRole(element: Element): RejectionMessageRole | null {
    let current: Element | null = element
    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
        const marker = `${current.className || ''} ${(current.getAttribute('data-from') || '')}`.toLowerCase()
        if (/(item-myself|message-self|message-mine|from-me|is-self|my-message|right-message)/.test(marker)) {
            return 'USER'
        }
        if (/(item-friend|message-friend|from-boss|from-other|is-friend|left-message)/.test(marker)) {
            return 'HR'
        }
    }
    return null
}

function rejectionDomMessageId(element: Element): string {
    let current: Element | null = element
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
        const id = normalizeProtocolId(
            current.getAttribute('data-mid')
            || current.getAttribute('data-cmid')
            || current.getAttribute('data-message-id'),
        )
        if (id) return id
    }
    return ''
}

function rejectionDomTimestamp(element: Element): number | undefined {
    let current: Element | null = element
    for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
        const timestamp = normalizeTimestamp(
            current.getAttribute('data-time')
            || current.getAttribute('data-timestamp'),
        )
        if (timestamp) return timestamp
    }
    return undefined
}

function rejectionDomText(element: Element): string {
    const clone = element.cloneNode(true) as Element
    clone.querySelectorAll([
        '#ai-job',
        '[contenteditable="true"]',
        'textarea',
        'input',
        'button',
        '[class*="system"]',
        '[class*="date"]',
        '[class*="time"]',
        '[class*="receipt"]',
        '[class*="read-status"]',
        '[class*="message-status"]',
    ].join(',')).forEach(child => child.remove())
    const text = String(clone.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text || /^(?:\[)?(?:送达|已读)(?:\])?$/.test(text)) return ''
    return text.slice(0, 4000)
}

/**
 * Best-effort current-page fallback. BOSS can virtualize or omit older rows,
 * so callers must always send POSSIBLY_INCOMPLETE regardless of row count.
 */
export function collectVisibleRejectionMessages(root: ParentNode = document): RejectionMessage[] {
    const conversation = root.querySelector('.chat-conversation')
    if (!conversation) return []
    const candidates = Array.from(conversation.querySelectorAll([
        '[data-mid]',
        '[data-cmid]',
        '[data-message-id]',
        '[class*="message-item"]',
        '[class*="item-friend"]',
        '[class*="item-myself"]',
        '[class*="message-friend"]',
        '[class*="message-self"]',
    ].join(','))).filter(element => !element.closest('#ai-job, [contenteditable="true"]'))

    const messages: RejectionMessage[] = []
    for (const element of candidates) {
        const role = rejectionDomRole(element)
        if (!role) continue
        const text = rejectionDomText(element)
        if (!text) continue
        const messageId = rejectionDomMessageId(element)
        const timestamp = rejectionDomTimestamp(element)
        messages.push({
            ...(messageId ? {messageId} : {}),
            role,
            text,
            ...(timestamp ? {timestamp} : {}),
        })
    }
    return mergeRejectionMessages(messages)
}

export function buildRejectionAnalyzePayload(input: {
    encryptJobId: string
    conversationKey: string
    bufferedMessages: RejectionMessage[]
    visibleMessages?: RejectionMessage[]
}): RejectionAnalyzePayload {
    const messages = mergeRejectionMessages(input.visibleMessages || [], input.bufferedMessages)
    recordRejectionDebugEvent('PAYLOAD_BUILD', 'SUCCEEDED', {
        bufferedMessageCount: input.bufferedMessages.length,
        visibleMessageCount: input.visibleMessages?.length || 0,
        messageCount: messages.length,
        completeness: REJECTION_CONVERSATION_COMPLETENESS,
    })
    return {
        encryptJobId: String(input.encryptJobId || '').trim(),
        conversationKey: String(input.conversationKey || '').trim(),
        completeness: REJECTION_CONVERSATION_COMPLETENESS,
        // The visible page can contain older virtualized history, while the
        // protocol buffer is the freshest source. Keep the fresh buffer last
        // so the final 12-message window cannot be displaced by old DOM rows.
        messages,
    }
}

export function shouldApplyAnalysisResult(requestConversationKey: string, currentConversationKey: string): boolean {
    return !!requestConversationKey && requestConversationKey === currentConversationKey
}

export function shouldShowRejectionSummary(summary: RejectionSummary | null | undefined): boolean {
    return !!summary?.visible && Number(summary.totalConfirmed) >= 5
}

async function apiRequest() {
    return (await import('../../axios')).default
}

export async function saveApplicationSnapshot(payload: ApplicationSnapshotPayload): Promise<ApplicationSnapshotVO> {
    const request = await apiRequest()
    const response = await request.post('/api/job/ai/applications/snapshot', payload, {timeout: 5000})
    return response.data.data as ApplicationSnapshotVO
}

export async function saveApplicationSnapshotWithRetry(
    payload: ApplicationSnapshotPayload,
    options: {
        retryDelaysMs?: number[]
        save?: (value: ApplicationSnapshotPayload) => Promise<ApplicationSnapshotVO>
        sleep?: (delayMs: number) => Promise<void>
    } = {},
): Promise<ApplicationSnapshotVO> {
    const retryDelaysMs = options.retryDelaysMs || [1_000, 3_000]
    const save = options.save || saveApplicationSnapshot
    const sleep = options.sleep || ((delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs)))
    let lastError: unknown
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
        const startedAt = Date.now()
        recordRejectionDebugEvent('SNAPSHOT_SAVE', 'STARTED', {attempt: attempt + 1})
        try {
            const result = await save(payload)
            recordRejectionDebugEvent('SNAPSHOT_SAVE', 'SUCCEEDED', {
                attempt: attempt + 1,
                durationMs: Date.now() - startedAt,
                applicationSnapshotId: result.id,
            })
            return result
        } catch (error) {
            lastError = error
            const finalAttempt = attempt >= retryDelaysMs.length
            recordRejectionDebugEvent('SNAPSHOT_SAVE', finalAttempt ? 'FAILED' : 'RETRYING', {
                attempt: attempt + 1,
                durationMs: Date.now() - startedAt,
                errorClass: classifyRejectionDebugError(error),
            })
            if (finalAttempt) break
            await sleep(retryDelaysMs[attempt])
        }
    }
    throw lastError
}

export async function analyzeRejection(payload: RejectionAnalyzePayload): Promise<RejectionAnalysisVO> {
    const startedAt = Date.now()
    recordRejectionDebugEvent('ANALYSIS', 'STARTED', {
        messageCount: payload.messages.length,
        completeness: payload.completeness,
    })
    try {
        const request = await apiRequest()
        const response = await request.post('/api/job/ai/rejections/analyze', payload, {timeout: 18_000})
        const result = response.data.data as RejectionAnalysisVO
        recordRejectionDebugEvent('ANALYSIS', 'SUCCEEDED', {
            durationMs: Date.now() - startedAt,
            analysisId: result.id,
            applicationSnapshotId: result.applicationSnapshotId,
            completeness: result.conversationCompleteness,
            analysisSource: result.analysisSource,
            analysisStatus: result.status,
            model: result.model,
            promptVersion: result.promptVersion,
        })
        return result
    } catch (error) {
        recordRejectionDebugEvent('ANALYSIS', 'FAILED', {
            durationMs: Date.now() - startedAt,
            errorClass: classifyRejectionDebugError(error),
        })
        throw error
    }
}

export async function submitRejectionFeedback(
    analysisId: number,
    payload: RejectionFeedbackPayload,
): Promise<RejectionAnalysisVO> {
    const startedAt = Date.now()
    recordRejectionDebugEvent('FEEDBACK', 'STARTED', {
        analysisId,
        feedbackAction: payload.action,
    })
    try {
        const request = await apiRequest()
        const response = await request.post(`/api/job/ai/rejections/${analysisId}/feedback`, payload)
        const result = response.data.data as RejectionAnalysisVO
        recordRejectionDebugEvent('FEEDBACK', 'SUCCEEDED', {
            durationMs: Date.now() - startedAt,
            analysisId: result.id,
            applicationSnapshotId: result.applicationSnapshotId,
            analysisStatus: result.status,
            feedbackAction: payload.action,
        })
        return result
    } catch (error) {
        recordRejectionDebugEvent('FEEDBACK', 'FAILED', {
            durationMs: Date.now() - startedAt,
            analysisId,
            feedbackAction: payload.action,
            errorClass: classifyRejectionDebugError(error),
        })
        throw error
    }
}

export async function getRejectionSummary(): Promise<RejectionSummary> {
    const startedAt = Date.now()
    recordRejectionDebugEvent('SUMMARY', 'STARTED')
    try {
        const request = await apiRequest()
        const response = await request.get('/api/job/ai/rejections/summary')
        const result = response.data.data as RejectionSummary
        recordRejectionDebugEvent('SUMMARY', 'SUCCEEDED', {
            durationMs: Date.now() - startedAt,
            totalConfirmed: result.totalConfirmed,
            summaryVisible: result.visible,
        })
        return result
    } catch (error) {
        recordRejectionDebugEvent('SUMMARY', 'FAILED', {
            durationMs: Date.now() - startedAt,
            errorClass: classifyRejectionDebugError(error),
        })
        throw error
    }
}
