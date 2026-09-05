import {
    arrayBufferToBase64,
    BACKGROUND_CHANNEL,
    BRIDGE_PROTOCOL_VERSION,
    DELIVERY_AUDIT_URL,
    isAllowedPageUrl,
    MAX_AUDIT_RESPONSE_BYTES,
    MAX_RESUME_BYTES,
    parseBackgroundRequest,
    RESUME_DOWNLOAD_URL,
} from './bridgeProtocol.ts'
import type {
    BackgroundRequest,
    BackgroundResponse,
    BridgeErrorKind,
    DeliveryAuditPayload,
    NotificationPayload,
    ResumeDownloadPayload,
} from './bridgeProtocol.ts'

export type BackgroundSender = {
    url?: string
    documentId?: string
    frameId?: number
    tab?: {id?: number, url?: string}
}

type TimerHandle = ReturnType<typeof setTimeout>

export type BackgroundServiceDependencies = {
    fetch: typeof fetch
    createNotification(payload: NotificationPayload): Promise<string>
    clearNotification(notificationId: string): Promise<boolean>
    setTimer(callback: () => void, delay: number): TimerHandle
    clearTimer(handle: TimerHandle): void
}

type ActiveRequest = {controller: AbortController}
type ActiveNotification = {owner: string, timeout: TimerHandle}

export function errorResponse(
    requestId: string,
    kind: BridgeErrorKind,
    error: unknown,
): BackgroundResponse {
    return {
        channel: BACKGROUND_CHANNEL,
        protocol: BRIDGE_PROTOCOL_VERSION,
        requestId,
        ok: false,
        operation: 'error',
        error: {kind, message: String((error as any)?.message || error || kind).slice(0, 500)},
    }
}

export function senderOwner(sender: BackgroundSender): string | null {
    const tabId = sender.tab?.id
    const frameId = sender.frameId
    const documentId = sender.documentId
    if (!Number.isSafeInteger(tabId) || Number(tabId) < 0
        || !Number.isSafeInteger(frameId) || Number(frameId) < 0
        || typeof documentId !== 'string' || documentId.length < 1 || documentId.length > 256) return null
    return JSON.stringify([tabId, documentId, frameId])
}

function requestKey(owner: string, requestId: string): string {
    return `${owner}\u0000${requestId}`
}

function responseHeaders(response: Response): Record<string, string> {
    return Object.fromEntries(response.headers.entries())
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
    const declaredLength = response.headers.get('content-length')
    if (declaredLength != null) {
        const parsedLength = Number(declaredLength)
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
            throw new Error(`响应体超过 ${maxBytes} 字节限制`)
        }
    }
    const body = await response.arrayBuffer()
    if (body.byteLength > maxBytes) throw new Error(`响应体超过 ${maxBytes} 字节限制`)
    return body
}

export function createBackgroundService(dependencies: BackgroundServiceDependencies) {
    const activeRequests = new Map<string, ActiveRequest>()
    const activeNotifications = new Map<string, ActiveNotification>()
    const notificationsByOwner = new Map<string, Set<string>>()

    const finishNotification = (notificationId: string): boolean => {
        const active = activeNotifications.get(notificationId)
        if (!active) return false
        activeNotifications.delete(notificationId)
        dependencies.clearTimer(active.timeout)
        const ownerNotifications = notificationsByOwner.get(active.owner)
        ownerNotifications?.delete(notificationId)
        if (ownerNotifications?.size === 0) notificationsByOwner.delete(active.owner)
        return true
    }

    const dismissNotification = async (notificationId: string): Promise<boolean> => {
        if (!finishNotification(notificationId)) return false
        return dependencies.clearNotification(notificationId)
    }

    const executeRequest = async (
        owner: string,
        requestId: string,
        request: Extract<BackgroundRequest, {operation: 'resume.download' | 'deliveryAudit.report'}>,
    ): Promise<BackgroundResponse> => {
        const key = requestKey(owner, requestId)
        if (activeRequests.has(key)) return errorResponse(requestId, 'denied', '同一页面中请求标识重复')
        const controller = new AbortController()
        activeRequests.set(key, {controller})
        let timedOut = false
        const timeoutMs = request.payload.timeout
        const timeout = dependencies.setTimer(() => {
            timedOut = true
            controller.abort()
        }, timeoutMs)
        try {
            let url: string
            let init: RequestInit
            let responseType: 'json' | 'arraybuffer'
            let maxResponseBytes: number
            if (request.operation === 'resume.download') {
                const payload = request.payload as ResumeDownloadPayload
                url = `${RESUME_DOWNLOAD_URL}?resumeId=${encodeURIComponent(payload.resumeId)}`
                init = {
                    method: 'GET',
                    headers: {Zp_token: payload.zpToken},
                    credentials: 'include',
                    redirect: 'error',
                    signal: controller.signal,
                }
                responseType = 'arraybuffer'
                maxResponseBytes = MAX_RESUME_BYTES
            } else {
                const payload = request.payload as DeliveryAuditPayload
                url = DELIVERY_AUDIT_URL
                init = {
                    method: 'POST',
                    headers: {
                        Authorization: payload.authorization,
                        'Content-Type': 'application/json; charset=utf-8',
                    },
                    body: JSON.stringify(payload.report),
                    credentials: 'include',
                    redirect: 'error',
                    signal: controller.signal,
                }
                responseType = 'json'
                maxResponseBytes = MAX_AUDIT_RESPONSE_BYTES
            }
            const response = await dependencies.fetch(url, init)
            const rawBody = await readBoundedBody(response, maxResponseBytes)
            const binary = responseType === 'arraybuffer'
            return {
                channel: BACKGROUND_CHANNEL,
                protocol: BRIDGE_PROTOCOL_VERSION,
                requestId,
                ok: true,
                operation: 'http-response',
                payload: {
                    finalUrl: response.url || url,
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders(response),
                    body: binary ? arrayBufferToBase64(rawBody) : new TextDecoder().decode(rawBody),
                    bodyEncoding: binary ? 'base64' : 'text',
                    responseType,
                },
            }
        } catch (error) {
            const kind: BridgeErrorKind = timedOut ? 'timeout' : controller.signal.aborted ? 'abort' : 'network'
            return errorResponse(requestId, kind, error)
        } finally {
            dependencies.clearTimer(timeout)
            if (activeRequests.get(key)?.controller === controller) activeRequests.delete(key)
        }
    }

    const createNotification = async (
        owner: string,
        request: Extract<BackgroundRequest, {operation: 'notification'}>,
    ): Promise<BackgroundResponse> => {
        const notificationId = await dependencies.createNotification(request.payload)
        const timeout = dependencies.setTimer(() => {
            void dismissNotification(notificationId)
        }, request.payload.timeout)
        activeNotifications.set(notificationId, {owner, timeout})
        const ownerNotifications = notificationsByOwner.get(owner) || new Set<string>()
        ownerNotifications.add(notificationId)
        notificationsByOwner.set(owner, ownerNotifications)
        return {
            channel: BACKGROUND_CHANNEL,
            protocol: BRIDGE_PROTOCOL_VERSION,
            requestId: request.requestId,
            ok: true,
            operation: 'notification-response',
            payload: {notificationId},
        }
    }

    return {
        async handleMessage(rawMessage: unknown, sender: BackgroundSender): Promise<BackgroundResponse> {
            const senderUrl = sender.url || sender.tab?.url
            if (!isAllowedPageUrl(senderUrl)) return errorResponse('invalid-sender', 'denied', '消息来源不在 BOSS 页面白名单')
            const owner = senderOwner(sender)
            if (!owner) return errorResponse('invalid-sender', 'denied', '消息来源缺少页面身份')
            const request = parseBackgroundRequest(rawMessage)
            if (!request) return errorResponse('invalid-request', 'invalid', '扩展后台拒绝了无效消息')
            const key = requestKey(owner, request.requestId)
            if (request.operation === 'request.abort') {
                activeRequests.get(key)?.controller.abort()
                return errorResponse(request.requestId, 'abort', '请求已取消')
            }
            if (request.operation === 'notification') return createNotification(owner, request)
            return executeRequest(owner, request.requestId, request)
        },
        handleNotificationClosed(notificationId: string): void {
            finishNotification(notificationId)
        },
        handleNotificationClicked(notificationId: string): void {
            void dismissNotification(notificationId)
        },
        dispose(): void {
            for (const {controller} of activeRequests.values()) controller.abort()
            activeRequests.clear()
            for (const notificationId of [...activeNotifications.keys()]) void dismissNotification(notificationId)
        },
    }
}
