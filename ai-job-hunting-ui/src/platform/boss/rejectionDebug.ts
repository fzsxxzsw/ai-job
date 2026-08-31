export const REJECTION_DEBUG_EVENT_LIMIT = 200
export const REJECTION_DEBUG_BRIDGE_KEY = '__AI_JOB_HELPER_REJECTION_DEBUG__' as const

export type RejectionDebugStage =
    | 'MESSAGE_BUFFER'
    | 'PAYLOAD_BUILD'
    | 'SNAPSHOT_SAVE'
    | 'ANALYSIS'
    | 'FEEDBACK'
    | 'SUMMARY'

export type RejectionDebugOutcome =
    | 'STARTED'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'RETRYING'
    | 'DUPLICATE'
    | 'SKIPPED'

export type RejectionDebugErrorClass =
    | 'TIMEOUT'
    | 'NETWORK'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'SERVER_ERROR'
    | 'CANCELLED'
    | 'UNKNOWN'

export interface RejectionDebugMetadata {
    attempt?: number
    durationMs?: number
    messageCount?: number
    bufferedMessageCount?: number
    visibleMessageCount?: number
    bufferSize?: number
    applicationSnapshotId?: number
    analysisId?: number
    completeness?: string
    analysisSource?: string
    analysisStatus?: string
    model?: string
    promptVersion?: string
    feedbackAction?: string
    totalConfirmed?: number
    summaryVisible?: boolean
    errorClass?: RejectionDebugErrorClass
}

export interface RejectionDebugEvent extends RejectionDebugMetadata {
    sequence: number
    timestamp: string
    stage: RejectionDebugStage
    outcome: RejectionDebugOutcome
}

export interface RejectionDebugSnapshot {
    schemaVersion: 1
    limit: typeof REJECTION_DEBUG_EVENT_LIMIT
    events: RejectionDebugEvent[]
}

export interface RejectionDebugBridge {
    getSnapshot: () => RejectionDebugSnapshot
    clear: () => void
}

type UnknownRecord = Record<string, unknown>

const events: RejectionDebugEvent[] = []
let sequence = 0

function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function safeNonNegativeInteger(value: unknown): number | undefined {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < 0) return undefined
    return number
}

function safeDuration(value: unknown): number | undefined {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return undefined
    return Math.min(Math.round(number), 3_600_000)
}

function safeCode(value: unknown, maxLength = 80): string | undefined {
    const code = String(value ?? '').trim()
    if (!code) return undefined
    const normalized = code.replace(/[^a-zA-Z0-9._:/-]/g, '_').slice(0, maxLength)
    return normalized || undefined
}

function safeCompleteness(value: unknown): string | undefined {
    return value === 'POSSIBLY_INCOMPLETE' || value === 'COMPLETE'
        ? value
        : undefined
}

function safeFeedbackAction(value: unknown): string | undefined {
    return value === 'CONFIRM' || value === 'CORRECT' || value === 'IGNORE'
        ? value
        : undefined
}

function safeAnalysisSource(value: unknown): string | undefined {
    return value === 'RULES_AI' || value === 'RULES_ONLY'
        ? value
        : undefined
}

function safeAnalysisStatus(value: unknown): string | undefined {
    return value === 'PENDING'
        || value === 'ANALYZED'
        || value === 'CONFIRMED'
        || value === 'CORRECTED'
        || value === 'IGNORED'
        ? value
        : undefined
}

function safeErrorClass(value: unknown): RejectionDebugErrorClass | undefined {
    const allowed: RejectionDebugErrorClass[] = [
        'TIMEOUT',
        'NETWORK',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'RATE_LIMITED',
        'SERVER_ERROR',
        'CANCELLED',
        'UNKNOWN',
    ]
    return allowed.includes(value as RejectionDebugErrorClass)
        ? value as RejectionDebugErrorClass
        : undefined
}

/**
 * Converts arbitrary runtime metadata into a deliberately small allow-list.
 * Never add request bodies, identifiers from BOSS, evidence, or error strings.
 */
function whitelistMetadata(input: unknown): RejectionDebugMetadata {
    const value = asRecord(input)
    const metadata: RejectionDebugMetadata = {}
    const assignInteger = (key: keyof RejectionDebugMetadata) => {
        const normalized = safeNonNegativeInteger(value[key])
        if (normalized !== undefined) Object.assign(metadata, {[key]: normalized})
    }
    for (const key of [
        'attempt',
        'messageCount',
        'bufferedMessageCount',
        'visibleMessageCount',
        'bufferSize',
        'applicationSnapshotId',
        'analysisId',
        'totalConfirmed',
    ] as const) assignInteger(key)

    const durationMs = safeDuration(value.durationMs)
    if (durationMs !== undefined) metadata.durationMs = durationMs
    const completeness = safeCompleteness(value.completeness)
    if (completeness) metadata.completeness = completeness
    const feedbackAction = safeFeedbackAction(value.feedbackAction)
    if (feedbackAction) metadata.feedbackAction = feedbackAction
    const errorClass = safeErrorClass(value.errorClass)
    if (errorClass) metadata.errorClass = errorClass
    if (typeof value.summaryVisible === 'boolean') metadata.summaryVisible = value.summaryVisible

    const analysisSource = safeAnalysisSource(value.analysisSource)
    if (analysisSource) metadata.analysisSource = analysisSource
    const analysisStatus = safeAnalysisStatus(value.analysisStatus)
    if (analysisStatus) metadata.analysisStatus = analysisStatus

    for (const key of ['model', 'promptVersion'] as const) {
        const normalized = safeCode(value[key])
        if (normalized) metadata[key] = normalized
    }
    return metadata
}

/**
 * Error diagnostics intentionally inspect only transport code/status. They do
 * not read Error.message, response.data, request config, or model output.
 */
export function classifyRejectionDebugError(error: unknown): RejectionDebugErrorClass {
    const value = asRecord(error)
    const response = asRecord(value.response)
    const status = Number(value.status ?? response.status)
    if (status === 401) return 'UNAUTHORIZED'
    if (status === 403) return 'FORBIDDEN'
    if (status === 404) return 'NOT_FOUND'
    if (status === 409) return 'CONFLICT'
    if (status === 429) return 'RATE_LIMITED'
    if (Number.isFinite(status) && status >= 500) return 'SERVER_ERROR'

    const code = String(value.code ?? '').toUpperCase()
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_TIMEOUT') return 'TIMEOUT'
    if (code === 'ERR_CANCELED' || code === 'ABORT_ERR') return 'CANCELLED'
    if (code === 'ERR_NETWORK' || code === 'ECONNRESET' || code === 'ECONNREFUSED') return 'NETWORK'
    return 'UNKNOWN'
}

export function recordRejectionDebugEvent(
    stage: RejectionDebugStage,
    outcome: RejectionDebugOutcome,
    metadata: RejectionDebugMetadata = {},
): void {
    events.push({
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        stage,
        outcome,
        ...whitelistMetadata(metadata),
    })
    if (events.length > REJECTION_DEBUG_EVENT_LIMIT) {
        events.splice(0, events.length - REJECTION_DEBUG_EVENT_LIMIT)
    }
}

export function getRejectionDebugSnapshot(): RejectionDebugSnapshot {
    return JSON.parse(JSON.stringify({
        schemaVersion: 1,
        limit: REJECTION_DEBUG_EVENT_LIMIT,
        events,
    })) as RejectionDebugSnapshot
}

export function clearRejectionDebugEvents(): void {
    events.splice(0, events.length)
    sequence = 0
}

export function installRejectionDebugBridge(targetWindow: UnknownRecord): RejectionDebugBridge {
    const bridge = Object.freeze<RejectionDebugBridge>({
        getSnapshot: getRejectionDebugSnapshot,
        clear: clearRejectionDebugEvents,
    })
    try {
        Object.defineProperty(targetWindow, REJECTION_DEBUG_BRIDGE_KEY, {
            configurable: true,
            enumerable: false,
            writable: false,
            value: bridge,
        })
    } catch (_) {
        // A hardened page may reject property installation; diagnostics remain
        // available to the in-app card through the module functions.
    }
    return bridge
}

export function buildSafeRejectionDiagnosticReport(input: unknown): UnknownRecord {
    const value = asRecord(input)
    const runtime = asRecord(value.runtime)
    const analysis = asRecord(value.analysis)
    const safeRuntime: UnknownRecord = {}
    const version = safeCode(runtime.version)
    const buildId = safeCode(runtime.buildId)
    if (version) safeRuntime.version = version
    if (buildId) safeRuntime.buildId = buildId

    const safeAnalysis = whitelistMetadata({
        analysisId: analysis.id,
        applicationSnapshotId: analysis.applicationSnapshotId,
        completeness: analysis.conversationCompleteness,
        analysisSource: analysis.analysisSource,
        analysisStatus: analysis.status,
        model: analysis.model,
        promptVersion: analysis.promptVersion,
    })
    return JSON.parse(JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runtime: safeRuntime,
        analysis: safeAnalysis,
        timeline: getRejectionDebugSnapshot(),
    })) as UnknownRecord
}
