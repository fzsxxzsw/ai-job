import {
    base64ToArrayBuffer,
    BRIDGE_PROTOCOL_VERSION,
    ISOLATED_WORLD_SOURCE,
    MAIN_WORLD_SOURCE,
    normalizeGmPrivilegedRequest,
    parsePageBridgeResponse,
} from './bridgeProtocol'
import type {HttpResponsePayload, PageBridgeRequest} from './bridgeProtocol'
import {SynchronousGmStorage} from './gmStorage'

type GmRequestOptions = {
    method?: string
    url: string
    headers?: Record<string, string>
    data?: string
    timeout?: number
    responseType?: 'text' | 'json' | 'arraybuffer'
    onload?: (response: GmResponse) => void
    onerror?: (response: GmErrorResponse) => void
    ontimeout?: (response: GmErrorResponse) => void
    onabort?: (response: GmErrorResponse) => void
    onreadystatechange?: (response: GmResponse) => void
}

type GmResponse = {
    finalUrl: string
    readyState: 4
    response: unknown
    responseHeaders: string
    responseText: string
    status: number
    statusText: string
}

type GmErrorResponse = {error: string}

type GmNotificationOptions = {
    title?: string
    text?: string
    image?: string
    highlight?: boolean
    silent?: boolean
    timeout?: number
    onclick?: () => void
    ondone?: () => void
}

type PendingRequest = {
    options: GmRequestOptions
    fallbackTimeout: number
}

const storage = new SynchronousGmStorage(window.localStorage, window)
const pendingRequests = new Map<string, PendingRequest>()
let requestSequence = 0

function nextRequestId(): string {
    requestSequence++
    return `gm-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function postToIsolated(request: PageBridgeRequest): void {
    window.postMessage(request, window.location.origin)
}

function responseHeaders(headers: Record<string, string>): string {
    return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')
}

function decodeHttpResponse(payload: HttpResponsePayload): GmResponse {
    let response: unknown = payload.body
    let responseText = payload.bodyEncoding === 'text' ? payload.body : ''
    if (payload.bodyEncoding === 'base64') {
        const buffer = base64ToArrayBuffer(payload.body)
        response = buffer
    } else if (payload.responseType === 'json') {
        try {
            response = payload.body ? JSON.parse(payload.body) : null
        } catch (_) {
            response = null
        }
    }
    return {
        finalUrl: payload.finalUrl,
        readyState: 4,
        response,
        responseHeaders: responseHeaders(payload.headers),
        responseText,
        status: payload.status,
        statusText: payload.statusText,
    }
}

function settleError(requestId: string, kind: string, message: string): void {
    const pending = pendingRequests.get(requestId)
    if (!pending) return
    pendingRequests.delete(requestId)
    window.clearTimeout(pending.fallbackTimeout)
    const response = {error: message}
    if (kind === 'timeout') pending.options.ontimeout?.(response)
    else if (kind === 'abort') pending.options.onabort?.(response)
    else pending.options.onerror?.(response)
}

window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const response = parsePageBridgeResponse(event.data)
    if (!response || response.operation === 'notification-response') return
    if (!response.ok) {
        settleError(response.requestId, response.error.kind, response.error.message)
        return
    }
    const pending = pendingRequests.get(response.requestId)
    if (!pending || response.operation !== 'http-response') return
    pendingRequests.delete(response.requestId)
    window.clearTimeout(pending.fallbackTimeout)
    const decoded = decodeHttpResponse(response.payload as HttpResponsePayload)
    pending.options.onreadystatechange?.(decoded)
    pending.options.onload?.(decoded)
})

export const unsafeWindow = window

export const GM_info = Object.freeze({
    script: Object.freeze({
        name: 'AI工作猎手',
        namespace: 'https://github.com/yangfeng20',
        version: typeof __AI_JOB_HELPER_RUNTIME_VERSION__ === 'string'
            ? __AI_JOB_HELPER_RUNTIME_VERSION__
            : '0.0.61',
    }),
    scriptHandler: 'AI Job Helper MV3',
})

export function GM_getValue<T>(key: string, defaultValue?: T): T {
    return storage.getValue(key, defaultValue)
}

export function GM_setValue(key: string, value: unknown): boolean {
    return storage.setValue(key, value)
}

export function GM_addValueChangeListener(
    key: string,
    callback: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
): number {
    return storage.addValueChangeListener(key, callback)
}

export function GM_xmlhttpRequest(options: GmRequestOptions): {abort: () => void} {
    const privilegedRequest = normalizeGmPrivilegedRequest(options)
    const requestId = nextRequestId()
    if (!privilegedRequest) {
        queueMicrotask(() => options.onerror?.({error: '请求被扩展白名单拒绝'}))
        return {abort() {}}
    }
    const fallbackTimeout = window.setTimeout(() => {
        settleError(requestId, 'timeout', '扩展后台请求超时')
    }, privilegedRequest.payload.timeout + 1_000)
    pendingRequests.set(requestId, {options, fallbackTimeout})
    postToIsolated({
        protocol: BRIDGE_PROTOCOL_VERSION,
        source: MAIN_WORLD_SOURCE,
        target: ISOLATED_WORLD_SOURCE,
        requestId,
        ...privilegedRequest,
    })
    return {
        abort() {
            if (!pendingRequests.has(requestId)) return
            postToIsolated({
                protocol: BRIDGE_PROTOCOL_VERSION,
                source: MAIN_WORLD_SOURCE,
                target: ISOLATED_WORLD_SOURCE,
                requestId,
                operation: 'request.abort',
                payload: {},
            })
            settleError(requestId, 'abort', '请求已取消')
        },
    }
}

export function GM_notification(options: GmNotificationOptions | string): void {
    const normalized = typeof options === 'string' ? {text: options} : options
    const requestId = nextRequestId()
    const timeout = Math.min(60_000, Math.max(1_000, Number(normalized.timeout || 10_000)))
    postToIsolated({
        protocol: BRIDGE_PROTOCOL_VERSION,
        source: MAIN_WORLD_SOURCE,
        target: ISOLATED_WORLD_SOURCE,
        requestId,
        operation: 'notification',
        payload: {
            title: String(normalized.title || 'Boss直聘批量投简历').slice(0, 128),
            text: String(normalized.text || '').slice(0, 1_000),
            silent: normalized.silent !== false,
            timeout,
        },
    })
    if (normalized.ondone) window.setTimeout(() => normalized.ondone?.(), timeout)
}
