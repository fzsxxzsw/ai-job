export const GEEK_CHAT_CONNECTED = 'CONNECTED'

type ProtocolHandler = (protocol: any) => void
type StatusHandler = (status: string) => void
type ErrorHandler = (error: unknown) => void

export type GeekChatTransportCallbacks = {
    onProtocol?: ProtocolHandler,
    onReady?: () => void,
    onStatus?: StatusHandler,
    onError?: ErrorHandler,
    onClientMidAssigned?: (originalClientMid: string, actualClientMid: string, message: any) => void,
}

type BoundListener = {
    target: any,
    event: string,
    listener: (payload?: any) => void,
}

type PendingHighLevelSend = {
    message: any,
    originalClientMid: string,
    toUid: number,
    bodyType: number,
    text: string,
    createdAt: number,
}

export type AcknowledgedDispatchGate = {
    promise: Promise<boolean>,
    acknowledge: () => void,
    acknowledgementTimedOut: () => void,
    settleDispatch: (dispatched: boolean, settledAt?: number) => void,
}

/**
 * Coordinate two independent signals: the SDK dispatch result and the server
 * acknowledgement. An ACK timeout is not a dispatch result, so it must not
 * resolve the caller while the SDK promise is still pending. Only an explicit
 * `dispatched=true` writes __dispatchedAt, which is the durable "do not retry"
 * evidence consumed by the delivery queues.
 */
export function createAcknowledgedDispatchGate(
    msgObj: any,
    attemptedAt = Date.now(),
): AcknowledgedDispatchGate {
    const metadata = msgObj || {}
    delete metadata.__dispatchStartedAt
    delete metadata.__dispatchedAt
    metadata.__dispatchAttemptedAt = attemptedAt
    metadata.__dispatchState = 'pending'

    let dispatchState: 'pending' | 'accepted' | 'rejected' = 'pending'
    let ackTimedOut = false
    let resolved = false
    let resolvePromise!: (value: boolean) => void
    const promise = new Promise<boolean>(resolve => {
        resolvePromise = resolve
    })
    const resolveOnce = (value: boolean) => {
        if (resolved) return
        resolved = true
        resolvePromise(value)
    }

    return {
        promise,
        acknowledge: () => resolveOnce(true),
        acknowledgementTimedOut: () => {
            ackTimedOut = true
            if (dispatchState !== 'pending') resolveOnce(false)
        },
        settleDispatch: (dispatched, settledAt = Date.now()) => {
            dispatchState = dispatched ? 'accepted' : 'rejected'
            metadata.__dispatchState = dispatchState
            if (dispatched) {
                metadata.__dispatchedAt = settledAt
                if (ackTimedOut) resolveOnce(false)
                return
            }
            delete metadata.__dispatchedAt
            resolveOnce(false)
        },
    }
}

function asArray(value: unknown): any[] {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

function isObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object'
}

function hasProtocolFields(value: unknown): boolean {
    if (!isObject(value) || Array.isArray(value)) return false
    return value.messages != null || value.messageSync != null || value.messageSyncs != null
}

function hasDirectMessageIdentity(value: Record<string, any>): boolean {
    return value.clientMid != null || value.clientMID != null
        || value.clientMessageId != null || value.cmid != null
}

/**
 * GeekChatCore versions wrap event and send results differently. Peel only the
 * common transport envelopes, stopping as soon as a protocol/direct payload is
 * reached so a legitimate nested message body is never unwrapped by accident.
 */
function unwrapCommonEnvelope(value: any): any {
    let current = value
    const visited = new Set<any>()
    for (let depth = 0; depth < 6; depth++) {
        if (!isObject(current) || Array.isArray(current) || hasProtocolFields(current)
            || hasDirectMessageIdentity(current)
            || visited.has(current)) return current
        visited.add(current)
        const key = ['data', 'result', 'payload'].find(candidate => current[candidate] != null)
        if (!key) return current
        current = current[key]
    }
    return current
}

function asProtocol(payload: any, field: 'messages' | 'messageSync', type: number): any {
    const source = unwrapCommonEnvelope(payload)
    if (hasProtocolFields(source)) return {...source}
    return {type, [field]: asArray(source)}
}

function extractHighLevelMessages(result: any): any[] {
    const source = unwrapCommonEnvelope(result)
    if (!source) return []
    if (Array.isArray(source)) return source
    if (!isObject(source)) return []
    if (source.messages != null) return asArray(source.messages)
    if (source.message != null) return asArray(source.message)
    return [source]
}

function normalizePositiveProtocolId(value: any): string {
    if (value == null) return ''
    let normalized = ''
    try {
        normalized = String(value?.toString?.() ?? value).trim()
    } catch (_) {
        return ''
    }
    if (!/^\d+$/.test(normalized)) return ''
    try {
        return BigInt(normalized) > 0n ? normalized : ''
    } catch (_) {
        return ''
    }
}

function extractHighLevelConfirmations(result: any): Array<{clientMid: string, serverMid: string}> {
    const source = unwrapCommonEnvelope(result)
    const candidates = Array.isArray(source)
        ? source
        : hasProtocolFields(source)
            ? [
                ...asArray(source?.messageSync ?? source?.messageSyncs),
                ...asArray(source?.messages),
            ]
            : asArray(source)
    const confirmations: Array<{clientMid: string, serverMid: string}> = []
    for (const candidate of candidates) {
        const clientMid = [candidate?.clientMid, candidate?.clientMID,
            candidate?.clientMessageId, candidate?.cmid]
            .map(normalizePositiveProtocolId).find(Boolean) || ''
        const serverMid = [candidate?.serverMid, candidate?.serverMID,
            candidate?.mid, candidate?.msgId, candidate?.messageId]
            .map(normalizePositiveProtocolId).find(Boolean) || ''
        // The locally encoded packet starts with mid === cmid. Only a distinct
        // server identity proves acknowledgement.
        if (clientMid && serverMid && clientMid !== serverMid) {
            confirmations.push({clientMid, serverMid})
        }
    }
    return Array.from(new Map(confirmations.map(item => [item.clientMid, item])).values())
}

function isExplicitHighLevelSendFailure(result: any): boolean {
    if (result === false) return true
    const source = unwrapCommonEnvelope(result)
    if (source === false) return true
    return isObject(source)
        && (source.success === false || source.ok === false || source.accepted === false)
}

/**
 * GeekChatCore 1.x emits the public, flattened message model through `message`,
 * while 2.x additionally emits raw protobuf-shaped messages through
 * `messageArrived`. Normalise both variants before they enter the existing chat
 * handler so the WebSocket hook is only a fallback, not a hard dependency.
 */
export function normalizeGeekChatMessage(message: any): any {
    if (!message || typeof message !== 'object') return message
    if (message.from?.uid && message.to?.uid && message.body) return message

    const fromUid = Number(message.fromUid ?? message.fromId)
    const toUid = Number(message.toUid ?? message.toId)
    if (!fromUid || !toUid) return message
    return {
        ...message,
        from: {
            uid: fromUid,
            source: Number(message.fromSource || 0),
            name: String(message.fromName || ''),
            avatar: String(message.fromAvatar || ''),
        },
        to: {
            uid: toUid,
            source: Number(message.toSource || 0),
        },
        body: {
            type: Number(message.bodyType || 1),
            templateId: Number(message.templateId || 1),
            text: String(message.text ?? message.showText ?? ''),
            image: message.image,
            action: message.action,
        },
    }
}

/**
 * GeekChatCore 2.x keeps its real WebSocket inside a SharedWorker. The page's
 * window.WebSocket therefore cannot be used as the source of truth. Normalise
 * the public SDK status/event shapes instead.
 */
export function normalizeGeekChatStatus(value: unknown): string {
    if (value === true) return GEEK_CHAT_CONNECTED
    // Several GeekChatCore builds expose the native WebSocket readyState enum.
    // Treat only the standards-defined OPEN value as connected.
    if (typeof value === 'number') {
        if (value === 0) return 'CONNECTING'
        if (value === 1) return GEEK_CHAT_CONNECTED
        if (value === 2 || value === 3) return 'DISCONNECTED'
        return ''
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase()
        if (normalized.includes('RECONNECT')) return 'RECONNECTING'
        if (normalized.includes('DISCONNECT') || normalized === 'CLOSED') return 'DISCONNECTED'
        if (normalized.includes('CONNECTING')) return 'CONNECTING'
        if (normalized === GEEK_CHAT_CONNECTED || normalized === 'OPEN') return GEEK_CHAT_CONNECTED
        return normalized
    }
    if (!value || typeof value !== 'object') return ''
    const source: any = value
    for (const candidate of [source.socketStatus, source.status, source.state, source.result, source.data]) {
        const normalized = normalizeGeekChatStatus(candidate)
        if (normalized) return normalized
    }
    return ''
}

export function buildGeekChatRecipient(message: any): any | undefined {
    const msgObj = message?.msgObj
    const uid = Number(msgObj?.to?.uid)
    const clientMid = String(msgObj?.cmid ?? msgObj?.mid ?? '').trim()
    if (!uid || !/^\d+$/.test(clientMid)) return undefined
    return {
        uid,
        friendSource: Number(msgObj?.to?.source || 0),
        source: Number(msgObj?.to?.source || 0),
        encryptUid: String(msgObj?.to?.name || ''),
        clientMid,
    }
}

export class GeekChatTransport {
    private readonly pageWindow: any
    private readonly callbacks: GeekChatTransportCallbacks
    private sdk: any
    private status = ''
    private lastError = ''
    private sendBlockedUntil = 0
    private listeners: BoundListener[] = []
    private eventTargets: any[] = []
    private forwardedPayloads = new WeakSet<object>()
    private pendingHighLevelSends: PendingHighLevelSend[] = []

    constructor(pageWindow: any, callbacks: GeekChatTransportCallbacks = {}) {
        this.pageWindow = pageWindow
        this.callbacks = callbacks
    }

    public getLastError(): string {
        return this.lastError
    }

    public getDiagnostics(): {
        coreAvailable: boolean,
        sdkAvailable: boolean,
        connectorAvailable: boolean,
        status: string,
        sendMethods: string[],
        lastError: string,
        summary: string,
    } {
        const coreAvailable = !!this.pageWindow?.GeekChatCore
        const sdkAvailable = !!this.sdk
        const connector = this.getConnector()
        const connectorAvailable = !!connector
        const methodNames = ['sendTextMessage', 'sendImageMessage', 'sendMessage', 'sendRead']
        const sendMethods = methodNames.filter(method =>
            typeof this.sdk?.[method] === 'function' || typeof connector?.[method] === 'function')
        const status = this.status || 'UNKNOWN'
        const summary = [
            `Core:${coreAvailable ? '存在' : '缺失'}`,
            `SDK:${sdkAvailable ? '存在' : '缺失'}`,
            `Connector:${connectorAvailable ? '存在' : '缺失'}`,
            `Status:${status}`,
            `Send:${sendMethods.join(',') || '无'}`,
        ].join(' / ')
        return {coreAvailable, sdkAvailable, connectorAvailable, status, sendMethods, lastError: this.lastError, summary}
    }

    public getStatus(): string {
        this.bindAvailableSdk()
        this.readSynchronousStatus()
        return this.status
    }

    public isReady(): boolean {
        return this.getStatus() === GEEK_CHAT_CONNECTED && Date.now() >= this.sendBlockedUntil
    }

    public bindAvailableSdk(): boolean {
        let nextSdk: any
        try {
            nextSdk = this.pageWindow?.GeekChatCore?.getInstance?.()
        } catch (error) {
            // GeekChatCore throws until BOSS has completed its own init().
            this.lastError = String((error as any)?.message || error || '')
            return false
        }
        if (!nextSdk) {
            this.lastError = this.pageWindow?.GeekChatCore
                ? 'BOSS GeekChatCore 已加载但尚未创建实例'
                : 'BOSS 尚未加载 GeekChatCore'
            return false
        }
        const nextEventTargets = this.getEventTargets(nextSdk)
        const eventTargetsUnchanged = nextSdk === this.sdk
            && nextEventTargets.length === this.eventTargets.length
            && nextEventTargets.every((target, index) => target === this.eventTargets[index])
        if (eventTargetsUnchanged) return true

        this.unbind()
        this.sdk = nextSdk
        this.eventTargets = nextEventTargets
        this.lastError = ''
        const forwardSync = (payload: any) => {
            if (!this.claimPayload(payload)) return
            this.callbacks.onProtocol?.(asProtocol(payload, 'messageSync', 5))
        }
        const forwardMessages = (payload: any) => {
            if (!this.claimPayload(payload)) return
            const protocol = asProtocol(payload, 'messages', 1)
            protocol.messages = asArray(protocol.messages).map(normalizeGeekChatMessage)
            protocol.messages.forEach((message: any) => this.correlateHighLevelOutgoing(message))
            this.callbacks.onProtocol?.(protocol)
        }
        for (const target of this.eventTargets) {
            this.bindEvent(target, 'socketStatus', payload => this.updateStatus(payload))
            this.bindEvent(target, 'connect', () => this.updateStatus(GEEK_CHAT_CONNECTED))
            this.bindEvent(target, 'close', () => this.updateStatus('DISCONNECTED'))
            this.bindEvent(target, 'reconnecting', () => this.updateStatus('RECONNECTING'))
            this.bindEvent(target, 'messageSync', forwardSync)
            this.bindEvent(target, 'messageDelivered', forwardMessages)
            this.bindEvent(target, 'messageArrived', forwardMessages)
            // GeekChatCore 1.0.x has no `messageArrived` public event. It emits the
            // flattened model through `message` instead. BOSS still A/B serves that
            // SDK, so supporting only the 2.x name makes automatic replies randomly
            // disappear for part of the sessions.
            this.bindEvent(target, 'message', forwardMessages)
            this.bindEvent(target, 'sendError', payload => this.reportError(payload))
            this.bindEvent(target, 'error', payload => this.reportError(payload))
        }
        this.readSynchronousStatus()
        return true
    }

    public async refreshReady(): Promise<boolean> {
        if (!this.bindAvailableSdk()) return false
        this.readSynchronousStatus()
        if (this.status === GEEK_CHAT_CONNECTED && Date.now() >= this.sendBlockedUntil) return true
        if (Date.now() < this.sendBlockedUntil) return false

        const connector = this.getConnector()
        const targets = [this.sdk, connector].filter((target, index, all) =>
            target && all.indexOf(target) === index)
        const candidates: Array<(() => unknown) | undefined> = []
        for (const target of targets) {
            const broadcastManager = target?.broadcastManager || target?.socketStrategy?.broadcastManager
            candidates.push(
                typeof target?.getStatus === 'function' ? () => target.getStatus() : undefined,
                typeof broadcastManager?.getSocketStatusAsync === 'function'
                    ? () => broadcastManager.getSocketStatusAsync()
                    : undefined,
                typeof broadcastManager?.getSocketStatus === 'function'
                    ? () => broadcastManager.getSocketStatus()
                    : undefined,
            )
        }

        for (const candidate of candidates) {
            if (!candidate) continue
            try {
                const value = await this.withTimeout(Promise.resolve(candidate()), 1_500)
                this.updateStatus(value)
                if (this.status === GEEK_CHAT_CONNECTED) return true
            } catch (error) {
                this.lastError = String((error as any)?.message || error || '')
            }
        }
        return false
    }

    public async ensureReady(timeoutMs = 8_000, pollIntervalMs = 250): Promise<boolean> {
        const deadline = Date.now() + Math.max(0, timeoutMs)
        do {
            if (await this.refreshReady()) return true
            if (Date.now() >= deadline) break
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
        } while (Date.now() <= deadline)
        if (!this.lastError) {
            this.lastError = `BOSS 消息服务尚未完成初始化（${this.getDiagnostics().summary}）`
        }
        return false
    }

    public async send(message: any): Promise<boolean> {
        if (!await this.refreshReady()) return false
        const connector = this.getConnector()
        const recipient = buildGeekChatRecipient(message)
        const body = message?.msgObj?.body
        if (!connector || !recipient || !body) return false

        let pendingSend: PendingHighLevelSend | undefined
        try {
            // GeekChatCore 1.x exposes the exact raw client path used by the
            // original working userscript. Prefer it when present: it preserves
            // our persisted clientMid and avoids the 1.x wrapper's master-tab
            // broadcast race. GeekChatCore 2.x SharedWorker builds do not expose
            // this path and continue through the supported high-level API below.
            let legacyRawClient: any
            try {
                legacyRawClient = this.sdk?.getClient?.()?.client
            } catch (_) {
                // Some 2.x builds expose a guarded getClient() even though their
                // supported send path is the SharedWorker connector below.
            }
            if (legacyRawClient && typeof legacyRawClient.send === 'function'
                && message?.msg instanceof Uint8Array) {
                await Promise.resolve(legacyRawClient.send(message))
                return true
            }
            // Newer BOSS builds expose the safe public send API on the SDK root,
            // while socketConnect may already report CONNECTED but still have no
            // internal client. Prefer the root facade and only fall back to the
            // connector when the facade does not expose a matching method.
            const sendTarget = this.getMessageSendTarget(body.type)
            pendingSend = this.trackHighLevelSend(message, recipient, body)
            let result: any
            if (body.type === 1 && typeof sendTarget?.sendTextMessage === 'function') {
                result = await Promise.resolve(sendTarget.sendTextMessage(recipient, String(body.text || '')))
            } else if (body.type === 1 && typeof sendTarget?.sendMessage === 'function') {
                result = await Promise.resolve(sendTarget.sendMessage(recipient, String(body.text || ''), 'text'))
            } else if (body.type === 3 && typeof sendTarget?.sendImageMessage === 'function') {
                result = await Promise.resolve(sendTarget.sendImageMessage(recipient, body.image))
            } else if (body.type === 3 && typeof sendTarget?.sendMessage === 'function') {
                result = await Promise.resolve(sendTarget.sendMessage(recipient, body.image, 'image'))
            } else {
                this.removePendingHighLevelSend(pendingSend)
                return false
            }
            if (isExplicitHighLevelSendFailure(result)) {
                this.removePendingHighLevelSend(pendingSend)
                return false
            }
            this.correlateHighLevelResult(result, pendingSend)
            this.sendBlockedUntil = 0
            return true
        } catch (error) {
            if (pendingSend) this.removePendingHighLevelSend(pendingSend)
            // Avoid treating a stale CONNECTED flag as send-ready on every 500ms
            // poll. The background monitor can retry after the SDK has recovered.
            this.sendBlockedUntil = Date.now() + 30_000
            this.reportError(error)
        }
        return false
    }

    public async sendRead(userId: string | number, messageId: string | number): Promise<boolean> {
        if (!await this.refreshReady()) return false
        const connector = this.getConnector()
        const sendTarget = typeof this.sdk?.sendRead === 'function' ? this.sdk : connector
        if (!sendTarget || typeof sendTarget.sendRead !== 'function') return false
        try {
            await Promise.resolve(sendTarget.sendRead({
                uid: Number(userId),
                friendSource: 0,
                source: 0,
            }, messageId))
            return true
        } catch (error) {
            this.reportError(error)
            return false
        }
    }

    public unbind(): void {
        for (const {target, event, listener} of this.listeners) {
            try {
                target?.off?.(event, listener)
            } catch (_) {
                // SDK replacement is best-effort; the old instance may already be destroyed.
            }
        }
        this.listeners = []
        this.eventTargets = []
        this.sdk = undefined
        this.status = ''
    }

    private getConnector(): any {
        return this.sdk?.socketConnect || this.sdk
    }

    private getEventTargets(sdk: any): any[] {
        let rawClient: any
        try {
            rawClient = sdk?.getClient?.()?.client
        } catch (_) {
            // SharedWorker builds may expose a guarded legacy accessor.
        }
        return [sdk, sdk?.socketConnect, rawClient]
            .filter((target, index, all) => target && typeof target?.on === 'function'
                && all.indexOf(target) === index)
    }

    /**
     * Root and socketConnect can synchronously relay the exact same payload.
     * Suppress only that turn; deleting in a microtask allows SDKs that reuse a
     * mutable event object for later messages to deliver it again.
     */
    private claimPayload(payload: any): boolean {
        const candidate = unwrapCommonEnvelope(payload)
        if (!isObject(candidate)) return true
        if (this.forwardedPayloads.has(candidate)) return false
        this.forwardedPayloads.add(candidate)
        Promise.resolve().then(() => this.forwardedPayloads.delete(candidate))
        return true
    }

    private getMessageSendTarget(bodyType: number): any {
        const methodNames = bodyType === 3
            ? ['sendImageMessage', 'sendMessage']
            : ['sendTextMessage', 'sendMessage']
        const connector = this.getConnector()
        return [this.sdk, connector].find((candidate, index, all) => candidate
            && all.indexOf(candidate) === index
            && methodNames.some(method => typeof candidate?.[method] === 'function'))
    }

    private trackHighLevelSend(message: any, recipient: any, body: any): PendingHighLevelSend {
        const now = Date.now()
        this.pendingHighLevelSends = this.pendingHighLevelSends
            .filter(entry => now - entry.createdAt < 15_000)
        const entry: PendingHighLevelSend = {
            message,
            originalClientMid: String(message?.msgObj?.cmid || ''),
            toUid: Number(recipient?.uid || 0),
            bodyType: Number(body?.type || 0),
            text: String(body?.text || ''),
            createdAt: now,
        }
        this.pendingHighLevelSends.push(entry)
        return entry
    }

    private removePendingHighLevelSend(entry: PendingHighLevelSend): void {
        this.pendingHighLevelSends = this.pendingHighLevelSends.filter(candidate => candidate !== entry)
    }

    private correlateHighLevelResult(result: any, pendingSend?: PendingHighLevelSend): void {
        let preferredPending = pendingSend
        for (const message of extractHighLevelMessages(result).map(normalizeGeekChatMessage)) {
            if (this.correlateHighLevelOutgoing(message, preferredPending)) {
                preferredPending = undefined
            }
        }

        const confirmations = extractHighLevelConfirmations(result)
        if (confirmations.length === 0) return
        if (preferredPending) {
            this.correlateHighLevelOutgoing({clientMid: confirmations[0].clientMid}, preferredPending)
        }
        // Feed only the ACK-shaped protocol into the existing bridge handler.
        // A direct send result may not contain from/to/body fields and therefore
        // must not be forwarded as a normal chat message.
        this.callbacks.onProtocol?.({type: 5, messageSync: confirmations})
    }

    private correlateHighLevelOutgoing(
        outgoing: any,
        preferredPending?: PendingHighLevelSend,
    ): boolean {
        const actualClientMid = String(outgoing?.cmid ?? outgoing?.clientMid
            ?? outgoing?.clientMID ?? outgoing?.clientMessageId ?? '').trim()
        if (!/^\d+$/.test(actualClientMid) || actualClientMid === '0') return false
        const toUid = Number(outgoing?.to?.uid ?? outgoing?.toUid ?? outgoing?.toId ?? 0)
        const bodyType = Number(outgoing?.body?.type ?? outgoing?.bodyType ?? 0)
        const text = String(outgoing?.body?.text ?? outgoing?.text ?? outgoing?.showText ?? '')
        const now = Date.now()
        const pending = preferredPending && this.pendingHighLevelSends.includes(preferredPending)
            ? preferredPending
            : this.pendingHighLevelSends.find(entry =>
                now - entry.createdAt < 15_000
                && entry.toUid === toUid
                && entry.bodyType === bodyType
                && entry.text === text)
        if (!pending) return false

        this.removePendingHighLevelSend(pending)
        if (pending.message?.msgObj) {
            pending.message.msgObj.cmid = actualClientMid
            pending.message.msgObj.mid = actualClientMid
        }
        this.callbacks.onClientMidAssigned?.(
            pending.originalClientMid,
            actualClientMid,
            pending.message,
        )
        return true
    }

    private bindEvent(target: any, event: string, listener: (payload?: any) => void): void {
        if (typeof target?.on !== 'function') return
        target.on(event, listener)
        this.listeners.push({target, event, listener})
    }

    private readSynchronousStatus(): void {
        const connector = this.getConnector()
        const targets = [this.sdk, connector].filter((target, index, all) =>
            target && all.indexOf(target) === index)
        const readers: Array<() => unknown> = []
        for (const target of targets) {
            const broadcastManager = target?.broadcastManager || target?.socketStrategy?.broadcastManager
            readers.push(
                () => target?.status,
                () => target?.currentStatus,
                () => target?.readyState,
                () => target?.client?.status,
                () => target?.client?.readyState,
                () => target?.socketStrategy?.socketStatus,
                () => typeof broadcastManager?.getSocketStatus === 'function'
                    ? broadcastManager.getSocketStatus()
                    : undefined,
            )
        }
        let fallbackStatus = ''
        for (const reader of readers) {
            try {
                const normalized = normalizeGeekChatStatus(reader())
                if (normalized === GEEK_CHAT_CONNECTED) {
                    this.updateStatus(normalized)
                    return
                }
                if (!fallbackStatus && normalized) fallbackStatus = normalized
            } catch (error) {
                this.lastError = String((error as any)?.message || error || '')
            }
        }
        if (fallbackStatus) this.updateStatus(fallbackStatus)
    }

    private updateStatus(value: unknown): void {
        const normalized = normalizeGeekChatStatus(value)
        if (!normalized) return
        const wasReady = this.status === GEEK_CHAT_CONNECTED
        this.status = normalized
        this.callbacks.onStatus?.(normalized)
        if (!wasReady && normalized === GEEK_CHAT_CONNECTED) {
            this.lastError = ''
            this.callbacks.onReady?.()
        }
    }

    private reportError(error: unknown): void {
        this.lastError = String((error as any)?.message || (error as any)?.error || error || '未知消息错误')
        this.callbacks.onError?.(error)
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('读取 BOSS 消息连接状态超时')), timeoutMs)
            promise.then(value => {
                clearTimeout(timer)
                resolve(value)
            }, error => {
                clearTimeout(timer)
                reject(error)
            })
        })
    }
}
