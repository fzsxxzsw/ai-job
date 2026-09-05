export const BRIDGE_PROTOCOL_VERSION = 1 as const
export const MAIN_WORLD_SOURCE = 'ai-job-helper-main' as const
export const ISOLATED_WORLD_SOURCE = 'ai-job-helper-isolated' as const
export const BACKGROUND_CHANNEL = 'ai-job-helper-background-v1' as const

export const RESUME_DOWNLOAD_URL = 'https://docdownload.zhipin.com/wflow/zpgeek/download/download4geek'
export const DELIVERY_AUDIT_URL = 'http://127.0.0.1:9100/api/job/delivery/audit'
export const MAX_RESUME_BYTES = 25 * 1024 * 1024
export const MAX_AUDIT_BODY_BYTES = 16 * 1024
export const MAX_AUDIT_RESPONSE_BYTES = 1024 * 1024

export type HttpResponseType = 'text' | 'json' | 'arraybuffer'

export type DeliveryAuditReport = {
    auditId: string
    deliveryKey: string
    kind: 'greeting' | 'ai-reply'
    status: 'queued' | 'sending' | 'acknowledged' | 'receipt' | 'failed' | 'blocked'
    jobTitle: string
    contentHash: string
    contentLength: number
    attempts: number
    createdAt: number
    updatedAt: number
    bossId?: string
    conversationKey?: string
    clientMid?: string
    serverMid?: string
}

export type ResumeDownloadPayload = {
    resumeId: string
    zpToken: string
    timeout: number
}

export type DeliveryAuditPayload = {
    authorization: string
    report: DeliveryAuditReport
    timeout: number
}

export type NotificationPayload = {
    title: string
    text: string
    silent: boolean
    timeout: number
}

export type PrivilegedGmRequest = {
    operation: 'resume.download'
    payload: ResumeDownloadPayload
} | {
    operation: 'deliveryAudit.report'
    payload: DeliveryAuditPayload
}

export type PageBridgeRequest = {
    protocol: typeof BRIDGE_PROTOCOL_VERSION
    source: typeof MAIN_WORLD_SOURCE
    target: typeof ISOLATED_WORLD_SOURCE
    requestId: string
} & (PrivilegedGmRequest | {
    operation: 'request.abort'
    payload: Record<string, never>
} | {
    operation: 'notification'
    payload: NotificationPayload
})

export type HttpResponsePayload = {
    finalUrl: string
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
    bodyEncoding: 'text' | 'base64'
    responseType: HttpResponseType
}

export type BridgeErrorKind = 'abort' | 'denied' | 'invalid' | 'network' | 'timeout'

export type PageBridgeResponse = {
    protocol: typeof BRIDGE_PROTOCOL_VERSION
    source: typeof ISOLATED_WORLD_SOURCE
    target: typeof MAIN_WORLD_SOURCE
    requestId: string
} & ({
    ok: true
    operation: 'http-response' | 'notification-response'
    payload: HttpResponsePayload | {notificationId: string}
} | {
    ok: false
    operation: 'error'
    error: {kind: BridgeErrorKind, message: string}
})

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type BackgroundRequest = DistributiveOmit<PageBridgeRequest, 'source' | 'target'> & {
    channel: typeof BACKGROUND_CHANNEL
}

export type BackgroundResponse = DistributiveOmit<PageBridgeResponse, 'source' | 'target'> & {
    channel: typeof BACKGROUND_CHANNEL
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const RESUME_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const AUDIT_FIELDS = new Set([
    'auditId', 'deliveryKey', 'kind', 'status', 'jobTitle', 'contentHash', 'contentLength', 'attempts',
    'createdAt', 'updatedAt', 'bossId', 'conversationKey', 'clientMid', 'serverMid',
])
const AUDIT_KINDS = new Set(['greeting', 'ai-reply'])
const AUDIT_STATUSES = new Set(['queued', 'sending', 'acknowledged', 'receipt', 'failed', 'blocked'])

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

function normalizeTimeout(value: unknown, fallback = 30_000): number | null {
    const timeout = Number(value || fallback)
    return Number.isFinite(timeout) && timeout >= 100 && timeout <= 120_000 ? timeout : null
}

function isHeaderValue(value: unknown, maxLength = 4_096): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= maxLength && !/[\r\n]/.test(value)
}

function normalizeExactHeaders(value: unknown, allowedNames: readonly string[]): Record<string, string> | null {
    if (!isObject(value)) return null
    const allowed = new Map(allowedNames.map(name => [name.toLowerCase(), name]))
    const entries = Object.entries(value)
    if (entries.length !== allowed.size) return null
    const normalized: Record<string, string> = {}
    for (const [rawName, headerValue] of entries) {
        const canonicalName = allowed.get(rawName.toLowerCase())
        if (!canonicalName || Object.hasOwn(normalized, canonicalName) || !isHeaderValue(headerValue)) return null
        normalized[canonicalName] = headerValue
    }
    return normalized
}

function hasExactUrlShape(value: unknown, expectedOrigin: string, expectedPath: string): value is string {
    if (typeof value !== 'string') return false
    try {
        const url = new URL(value)
        return !url.username && !url.password && !url.hash && url.origin === expectedOrigin && url.pathname === expectedPath
    } catch (_) {
        return false
    }
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined | null {
    if (value == null) return undefined
    if (typeof value !== 'string' || value.length > maxLength || /\u0000/.test(value)) return null
    return value
}

export function normalizeDeliveryAuditReport(value: unknown): DeliveryAuditReport | null {
    if (!isObject(value) || Object.keys(value).some(key => !AUDIT_FIELDS.has(key))) return null
    if (typeof value.auditId !== 'string' || value.auditId.length < 1 || value.auditId.length > 256
        || typeof value.deliveryKey !== 'string' || value.deliveryKey.length < 1 || value.deliveryKey.length > 256
        || typeof value.kind !== 'string' || !AUDIT_KINDS.has(value.kind)
        || typeof value.status !== 'string' || !AUDIT_STATUSES.has(value.status)
        || typeof value.jobTitle !== 'string' || value.jobTitle.length > 300
        || typeof value.contentHash !== 'string' || value.contentHash.length < 1 || value.contentHash.length > 256
        || !Number.isSafeInteger(value.contentLength) || Number(value.contentLength) < 0 || Number(value.contentLength) > 1_000_000
        || !Number.isSafeInteger(value.attempts) || Number(value.attempts) < 0 || Number(value.attempts) > 100
        || !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 0
        || !Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) < 0) return null

    const bossId = normalizeOptionalString(value.bossId, 128)
    const conversationKey = normalizeOptionalString(value.conversationKey, 512)
    const clientMid = normalizeOptionalString(value.clientMid, 128)
    const serverMid = normalizeOptionalString(value.serverMid, 128)
    if (bossId === null || conversationKey === null || clientMid === null || serverMid === null) return null

    const normalized: DeliveryAuditReport = {
        auditId: value.auditId,
        deliveryKey: value.deliveryKey,
        kind: value.kind as DeliveryAuditReport['kind'],
        status: value.status as DeliveryAuditReport['status'],
        jobTitle: value.jobTitle,
        contentHash: value.contentHash,
        contentLength: Number(value.contentLength),
        attempts: Number(value.attempts),
        createdAt: Number(value.createdAt),
        updatedAt: Number(value.updatedAt),
        ...(bossId !== undefined ? {bossId} : {}),
        ...(conversationKey !== undefined ? {conversationKey} : {}),
        ...(clientMid !== undefined ? {clientMid} : {}),
        ...(serverMid !== undefined ? {serverMid} : {}),
    }
    return new TextEncoder().encode(JSON.stringify(normalized)).byteLength <= MAX_AUDIT_BODY_BYTES ? normalized : null
}

function normalizeResumePayload(value: unknown): ResumeDownloadPayload | null {
    if (!isObject(value) || Object.keys(value).some(key => !['resumeId', 'zpToken', 'timeout'].includes(key))) return null
    const timeout = normalizeTimeout(value.timeout)
    if (typeof value.resumeId !== 'string' || !RESUME_ID_PATTERN.test(value.resumeId)
        || !isHeaderValue(value.zpToken) || timeout === null) return null
    return {resumeId: value.resumeId, zpToken: value.zpToken, timeout}
}

function normalizeAuditPayload(value: unknown): DeliveryAuditPayload | null {
    if (!isObject(value) || Object.keys(value).some(key => !['authorization', 'report', 'timeout'].includes(key))) return null
    const timeout = normalizeTimeout(value.timeout, 5_000)
    const report = normalizeDeliveryAuditReport(value.report)
    if (!isHeaderValue(value.authorization) || timeout === null || !report) return null
    return {authorization: value.authorization, report, timeout}
}

export function normalizeGmPrivilegedRequest(value: unknown): PrivilegedGmRequest | null {
    if (!isObject(value)) return null
    const method = String(value.method || 'GET').toUpperCase()
    const responseType = String(value.responseType || 'json')
    const timeout = normalizeTimeout(value.timeout, method === 'POST' ? 5_000 : 30_000)
    if (timeout === null) return null

    if (hasExactUrlShape(value.url, 'https://docdownload.zhipin.com', '/wflow/zpgeek/download/download4geek')) {
        const url = new URL(value.url)
        const queryKeys = [...url.searchParams.keys()]
        const resumeIds = url.searchParams.getAll('resumeId')
        const headers = normalizeExactHeaders(value.headers, ['Zp_token'])
        if (method !== 'GET' || responseType !== 'arraybuffer' || value.data != null || !headers
            || queryKeys.length !== 1 || queryKeys[0] !== 'resumeId' || resumeIds.length !== 1
            || !RESUME_ID_PATTERN.test(resumeIds[0])) return null
        return {operation: 'resume.download', payload: {resumeId: resumeIds[0], zpToken: headers.Zp_token, timeout}}
    }

    if (hasExactUrlShape(value.url, 'http://127.0.0.1:9100', '/api/job/delivery/audit')) {
        const url = new URL(value.url)
        const headers = normalizeExactHeaders(value.headers, ['Authorization', 'Content-Type'])
        if (method !== 'POST' || url.search || responseType !== 'json' || !headers
            || headers['Content-Type'].toLowerCase() !== 'application/json; charset=utf-8'
            || typeof value.data !== 'string' || new TextEncoder().encode(value.data).byteLength > MAX_AUDIT_BODY_BYTES) return null
        let parsedBody: unknown
        try {
            parsedBody = JSON.parse(value.data)
        } catch (_) {
            return null
        }
        const report = normalizeDeliveryAuditReport(parsedBody)
        if (!report) return null
        return {operation: 'deliveryAudit.report', payload: {authorization: headers.Authorization, report, timeout}}
    }
    return null
}

function normalizeNotification(value: unknown): NotificationPayload | null {
    if (!isObject(value) || Object.keys(value).some(key => !['title', 'text', 'silent', 'timeout'].includes(key))) return null
    if (typeof value.title !== 'string' || typeof value.text !== 'string') return null
    const timeout = Number(value.timeout || 10_000)
    if (value.title.length > 128 || value.text.length > 1_000
        || !Number.isFinite(timeout) || timeout < 1_000 || timeout > 60_000) return null
    return {title: value.title, text: value.text, silent: value.silent !== false, timeout}
}

export function isAllowedPageUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'www.zhipin.com'
            && !url.username && !url.password
            && (url.pathname.startsWith('/web/geek/') || url.pathname.startsWith('/overseas/'))
    } catch (_) {
        return false
    }
}

export function parsePageBridgeRequest(value: unknown): PageBridgeRequest | null {
    if (!isObject(value) || value.protocol !== BRIDGE_PROTOCOL_VERSION
        || value.source !== MAIN_WORLD_SOURCE || value.target !== ISOLATED_WORLD_SOURCE
        || !isRequestId(value.requestId)) return null
    if (value.operation === 'resume.download') {
        const payload = normalizeResumePayload(value.payload)
        return payload ? {...value, operation: 'resume.download', payload} as PageBridgeRequest : null
    }
    if (value.operation === 'deliveryAudit.report') {
        const payload = normalizeAuditPayload(value.payload)
        return payload ? {...value, operation: 'deliveryAudit.report', payload} as PageBridgeRequest : null
    }
    if (value.operation === 'request.abort') return {...value, operation: 'request.abort', payload: {}} as PageBridgeRequest
    if (value.operation === 'notification') {
        const payload = normalizeNotification(value.payload)
        return payload ? {...value, operation: 'notification', payload} as PageBridgeRequest : null
    }
    return null
}

export function toBackgroundRequest(request: PageBridgeRequest): BackgroundRequest {
    const {source: _source, target: _target, ...payload} = request
    return {...payload, channel: BACKGROUND_CHANNEL}
}

export function parseBackgroundRequest(value: unknown): BackgroundRequest | null {
    if (!isObject(value) || value.channel !== BACKGROUND_CHANNEL || !isRequestId(value.requestId)) return null
    return parsePageBridgeRequest({...value, source: MAIN_WORLD_SOURCE, target: ISOLATED_WORLD_SOURCE})
        ? value as BackgroundRequest : null
}

export function toPageBridgeResponse(response: BackgroundResponse): PageBridgeResponse {
    const {channel: _channel, ...payload} = response
    return {...payload, source: ISOLATED_WORLD_SOURCE, target: MAIN_WORLD_SOURCE} as PageBridgeResponse
}

export function parsePageBridgeResponse(value: unknown): PageBridgeResponse | null {
    if (!isObject(value) || value.protocol !== BRIDGE_PROTOCOL_VERSION
        || value.source !== ISOLATED_WORLD_SOURCE || value.target !== MAIN_WORLD_SOURCE
        || !isRequestId(value.requestId)) return null
    if (value.ok === false && value.operation === 'error' && isObject(value.error)
        && typeof value.error.kind === 'string' && typeof value.error.message === 'string') return value as unknown as PageBridgeResponse
    if (value.ok === true && (value.operation === 'http-response' || value.operation === 'notification-response')
        && isObject(value.payload)) return value as unknown as PageBridgeResponse
    return null
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
    }
    return btoa(binary)
}

export function base64ToArrayBuffer(encoded: string): ArrayBuffer {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes.buffer
}
