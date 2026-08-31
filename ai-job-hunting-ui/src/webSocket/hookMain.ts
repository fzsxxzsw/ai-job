import {decodeMqttAndProtobuf, getMsgBody, normalizeNumber} from './utils';
import logger from "../logging";
import {BossOption} from '../platform/bossPlatform';
import {Tools} from "../platform/utils";
import {TechwolfChatProtocol} from "./protobuf";
import {AiPower} from "../platform/aiPower";
import {LogRecorder} from "../logging/record";
import {UserStore} from "../stores";
import {mqtt} from "./mqtt";
import {
    CHAT_BRIDGE_READY_EVENT,
    extractDeliveryConfirmations,
    normalizeProtocolId,
} from "./chatDelivery";
import {userRemoteLoad} from "../stores/remote";
import {createAcknowledgedDispatchGate, GeekChatTransport} from "./geekChatTransport";
import {shouldHandleManualOutgoingEcho} from "./manualOutgoing";
import {appendRejectionMessage} from "../platform/boss/rejectionAnalysis";
import {makeConversationKey} from "../platform/deliveryAudit";

const WS_HOOK_LOCK_KEY = '__AI_JOB_HELPER_WS_HOOK_V2__'
const existingHookStatus = Tools.window[WS_HOOK_LOCK_KEY]

if (existingHookStatus?.active) {
    existingHookStatus.duplicateStarts = Number(existingHookStatus.duplicateStarts || 0) + 1
    existingHookStatus.lastDuplicateAt = Date.now()
    logger.warn('检测到AI坐席 WebSocket Hook 重复初始化，本次已拦截')
} else {
const hookRuntimeStatus = {
    active: true,
    startedAt: Date.now(),
    duplicateStarts: 0,
    hookSuccessCount: 0,
    lastConnectedAt: 0,
    lastError: '',
}
Tools.window[WS_HOOK_LOCK_KEY] = hookRuntimeStatus

const originalWebSocket = Tools.window.WebSocket as typeof WebSocket;
const TARGET_URL: string = 'chat';
const logRecorder: LogRecorder = new LogRecorder('hook');
logRecorder.info("---------------------------------------------------------------");
logRecorder.info("WS Hook Start");

//======================================================================================================================
// 预先定义的ws send以及onmessage拦截
let sendInterceptor: ((data: any) => any) | null = null;
let receiveInterceptor: ((data: any) => any) | null = null;

//======================================================================================================================
let hookMap = new Map()
let hookPrototype = false
let outgoingMessageId = 1
const observedSockets = new WeakSet<WebSocket>()
const pendingMessageAcks = new Map<string, (confirmation: {clientMid: string, serverMid: string}) => void>()
const clientMidAliases = new Map<string, string>()
const clientMidAliasCreatedAt = new Map<string, number>()
const recentMessageAcks = new Map<string, {serverMid: string, receivedAt: number}>()
const automatedOutgoingClientMids = new Map<string, number>()
const recentManualOutgoingEvents = new Map<string, number>()
const RECENT_ACK_TTL_MS = 10 * 60 * 1000
const MANUAL_EVENT_TTL_MS = 15_000

function pruneAckState(now = Date.now()): void {
    for (const [key, confirmation] of recentMessageAcks) {
        if (now - confirmation.receivedAt >= RECENT_ACK_TTL_MS) recentMessageAcks.delete(key)
    }
    for (const [actualClientMid, createdAt] of clientMidAliasCreatedAt) {
        if (now - createdAt < RECENT_ACK_TTL_MS) continue
        clientMidAliasCreatedAt.delete(actualClientMid)
        clientMidAliases.delete(actualClientMid)
    }
}

function findRecentMessageAck(clientMid: string): {
    clientMid: string,
    serverMid: string,
    receivedAt: number,
} | undefined {
    pruneAckState()
    const direct = recentMessageAcks.get(clientMid)
    if (direct) return {clientMid, ...direct}
    for (const [actualClientMid, originalClientMid] of clientMidAliases) {
        if (originalClientMid !== clientMid) continue
        const aliased = recentMessageAcks.get(actualClientMid)
        if (aliased) return {clientMid: actualClientMid, ...aliased}
    }
    return undefined
}

function rememberAutomatedClientMid(clientMid: string): void {
    const now = Date.now()
    automatedOutgoingClientMids.set(clientMid, now)
    for (const [key, createdAt] of automatedOutgoingClientMids) {
        if (now - createdAt >= RECENT_ACK_TTL_MS) automatedOutgoingClientMids.delete(key)
    }
}

function isAutomatedOutgoingMessage(message: any): boolean {
    const clientMid = normalizeProtocolId(message?.cmid ?? message?.clientMid)
    if (clientMid && automatedOutgoingClientMids.has(clientMid)) return true
    const messageMid = normalizeProtocolId(message?.mid ?? message?.messageId)
    return !!messageMid && Array.from(recentMessageAcks.values())
        .some(confirmation => confirmation.serverMid === messageMid)
}

function claimManualOutgoingEvent(message: any, toUid: number, text: string): boolean {
    const now = Date.now()
    for (const [key, handledAt] of recentManualOutgoingEvents) {
        if (now - handledAt >= MANUAL_EVENT_TTL_MS) recentManualOutgoingEvents.delete(key)
    }
    const protocolId = normalizeProtocolId(message?.cmid ?? message?.clientMid
        ?? message?.mid ?? message?.messageId)
    let contentHash = 2166136261
    for (let index = 0; index < text.length; index++) {
        contentHash ^= text.charCodeAt(index)
        contentHash = Math.imul(contentHash, 16777619)
    }
    const keys = [
        protocolId ? `id:${protocolId}` : '',
        `content:${toUid}:${text.length}:${contentHash >>> 0}`,
    ].filter(Boolean)
    if (keys.some(key => recentManualOutgoingEvents.has(key))) return false
    keys.forEach(key => recentManualOutgoingEvents.set(key, now))
    return true
}

function getOpenChatSocket(): WebSocket | undefined {
    return Array.from(hookMap.values()).find((socket: WebSocket) =>
        socket?.readyState === originalWebSocket.OPEN && String(socket.url || '').includes(TARGET_URL)
    ) as WebSocket | undefined
}

function announceChatBridgeReady(): void {
    hookRuntimeStatus.lastConnectedAt = Date.now()
    hookRuntimeStatus.lastError = ''
    try {
        Tools.window.dispatchEvent(new Tools.window.CustomEvent(CHAT_BRIDGE_READY_EVENT))
    } catch (_) {
        // The bridge remains usable even if another userscript replaced CustomEvent.
    }
}

function announceChatSocketReady(socket: WebSocket): void {
    if (socket.readyState !== originalWebSocket.OPEN) return
    announceChatBridgeReady()
}

const geekChatTransport = new GeekChatTransport(Tools.window, {
    onReady: () => {
        announceChatBridgeReady()
        logRecorder.info('AI消息通道已通过 BOSS GeekChatCore 连接')
    },
    onProtocol: protocol => {
        void handleReceivedChatProtocol(protocol).catch(error => {
            logRecorder.error('处理 GeekChatCore 消息失败', error)
        })
    },
    onError: error => {
        hookRuntimeStatus.lastError = String((error as any)?.message || (error as any)?.error || error || '')
    },
    onClientMidAssigned: (originalClientMid, actualClientMid) => {
        if (!originalClientMid || !actualClientMid) return
        clientMidAliases.set(actualClientMid, originalClientMid)
        clientMidAliasCreatedAt.set(actualClientMid, Date.now())
        pruneAckState()
        rememberAutomatedClientMid(actualClientMid)
        const recentAck = recentMessageAcks.get(actualClientMid)
        if (recentAck) {
            pendingMessageAcks.get(originalClientMid)?.({
                clientMid: actualClientMid,
                serverMid: recentAck.serverMid,
            })
        }
    },
})

function clearClientMidAliases(waiterClientMid: string): void {
    for (const [actualClientMid, originalClientMid] of clientMidAliases) {
        if (actualClientMid === waiterClientMid || originalClientMid === waiterClientMid) {
            clientMidAliases.delete(actualClientMid)
            clientMidAliasCreatedAt.delete(actualClientMid)
        }
    }
}

async function dispatchChatMessage(message: {msg?: Uint8Array, msgObj?: any}): Promise<boolean> {
    if (geekChatTransport.isReady() && await geekChatTransport.send(message)) {
        return true
    }
    const socket = getOpenChatSocket()
    if (!socket || !(message?.msg instanceof Uint8Array)) return false
    outgoingMessageId = outgoingMessageId >= 65535 ? 1 : outgoingMessageId + 1
    socket.send(mqtt.encode({payload: message.msg, messageId: outgoingMessageId}))
    return true
}

// Stable bridge used by custom greetings and AI replies. It sends the already encoded
// protobuf message through the real BOSS chat socket instead of relying on a brittle
// copy of BOSS's private ChatWebsocket class.
Tools.window.AIJobHelperChatBridge = {
    isReady: () => geekChatTransport.isReady() || !!getOpenChatSocket(),
    ensureReady: async (timeoutMs = 8_000) => {
        if (getOpenChatSocket()) return true
        const ready = await geekChatTransport.ensureReady(timeoutMs)
        if (!ready) hookRuntimeStatus.lastError = geekChatTransport.getLastError()
        return ready || !!getOpenChatSocket()
    },
    getLastError: () => hookRuntimeStatus.lastError || geekChatTransport.getLastError(),
    getDiagnostics: () => geekChatTransport.getDiagnostics(),
    getAcknowledgement: (clientMid: string | number) => {
        const normalizedClientMid = normalizeProtocolId(clientMid)
        return normalizedClientMid ? findRecentMessageAck(normalizedClientMid) : undefined
    },
    send: async (message: {msg?: Uint8Array, msgObj?: any}) => {
        if (!(message?.msg instanceof Uint8Array)) {
            return false
        }
        const clientMid = normalizeProtocolId(message?.msgObj?.cmid || message?.msgObj?.mid)
        if (!clientMid) {
            return await dispatchChatMessage(message)
        }
        // Retain plugin ownership independently of ACK timing. GeekChatCore also
        // echoes local outgoing messages, which is how manual intervention is seen.
        rememberAutomatedClientMid(clientMid)
        const recentAck = findRecentMessageAck(clientMid)
        if (recentAck) {
            message.msgObj.cmid = recentAck.clientMid
            ;(message.msgObj as any).__serverMid = recentAck.serverMid
            return true
        }
        // Register the ACK waiter before sending. BOSS can acknowledge very quickly,
        // and registering afterwards could lose that ACK and incorrectly queue a retry.
        const dispatchGate = createAcknowledgedDispatchGate(message.msgObj)
        const timeout = window.setTimeout(() => {
            pendingMessageAcks.delete(clientMid)
            // ACK timeout and dispatch result are independent. If the SDK promise
            // has not settled yet, the gate stays pending instead of manufacturing
            // durable "dispatched" evidence from an attempted write.
            dispatchGate.acknowledgementTimedOut()
        }, 8_000)
        pendingMessageAcks.set(clientMid, (confirmation) => {
            window.clearTimeout(timeout)
            pendingMessageAcks.delete(clientMid)
            clearClientMidAliases(clientMid)
            message.msgObj.cmid = confirmation.clientMid
            ;(message.msgObj as any).__serverMid = confirmation.serverMid
            dispatchGate.acknowledge()
        })
        void dispatchChatMessage(message).then(dispatched => {
            if (dispatched) {
                // The ACK waiter may have timed out while the SDK promise was
                // pending. Reconcile a concurrently received ACK before the gate
                // turns an accepted-but-unacknowledged dispatch into `false`.
                const lateAck = findRecentMessageAck(clientMid)
                if (lateAck) {
                    message.msgObj.cmid = lateAck.clientMid
                    ;(message.msgObj as any).__serverMid = lateAck.serverMid
                    dispatchGate.acknowledge()
                }
                dispatchGate.settleDispatch(true)
                return
            }
            window.clearTimeout(timeout)
            pendingMessageAcks.delete(clientMid)
            clearClientMidAliases(clientMid)
            dispatchGate.settleDispatch(false)
        }).catch(error => {
            window.clearTimeout(timeout)
            pendingMessageAcks.delete(clientMid)
            clearClientMidAliases(clientMid)
            dispatchGate.settleDispatch(false)
            logRecorder.error('消息 bridge send failed', error)
        })
        return dispatchGate.promise
    },
    sendRead: async (userId: string | number, messageId: string | number) => {
        return await geekChatTransport.sendRead(userId, messageId)
    },
    confirm: (clientMid: string | number, serverMid: string | number) => {
        const normalizedClientMid = normalizeProtocolId(clientMid)
        const normalizedServerMid = normalizeProtocolId(serverMid)
        if (!normalizedClientMid || !normalizedServerMid) return
        recentMessageAcks.set(normalizedClientMid, {
            serverMid: normalizedServerMid,
            receivedAt: Date.now(),
        })
        pruneAckState()
        const waiterClientMid = pendingMessageAcks.has(normalizedClientMid)
            ? normalizedClientMid
            : clientMidAliases.get(normalizedClientMid)
        if (!waiterClientMid) return
        pendingMessageAcks.get(waiterClientMid)?.({
            clientMid: normalizedClientMid,
            serverMid: normalizedServerMid,
        })
    },
}

class WebSocketProxy extends originalWebSocket {
    constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        url = url.replace(":443", "");
        const shouldHook = url.includes(TARGET_URL);

        if (!shouldHook) {
            return this;
        }
        hookPrototype = true;
        hookMap.set(url, this)
        this.addEventListener('open', () => announceChatSocketReady(this), {once: true})
        this.addEventListener('close', () => {
            if (hookMap.get(url) === this) hookMap.delete(url)
        }, {once: true})
        hookReceiveForInstance(this)
        hookRuntimeStatus.hookSuccessCount += 1
        logRecorder.info("WS Hook success ", url)
        announceChatSocketReady(this)

        const originalSend = this.send;
        this.send = (data: any) => {
            if (sendInterceptor) {
                data = sendInterceptor(data);
                if (data === undefined) return
            }
            return originalSend.call(this, data);
        };
    }
}

Tools.window.WebSocket = WebSocketProxy as any;

// BOSS 目前把聊天 WebSocket 放在 SharedWorker 内，window.WebSocket 无法观察。
// 持续绑定官方 GeekChatCore；旧页面若仍创建原生 socket，则保留下面的 Hook 兼容。
void (async () => {
    while (hookRuntimeStatus.active) {
        await geekChatTransport.refreshReady()
        await Tools.sleep(1_000)
    }
})().catch(error => {
    hookRuntimeStatus.lastError = String(error?.message || error)
    logRecorder.error('AI消息通道监控失败', error)
})

/**
 * Hook existing WebSocket instances by intercepting the send method
 */
let hookReceived = false;

function hookExistingWebSockets() {

    const wsInstance = hookPrototype ? Tools.window.WebSocket : originalWebSocket;
    const originalSend = hookPrototype ? Tools.window.WebSocket.prototype.send : originalWebSocket.prototype.send;

    // Override the send method to capture instances and intercept data
    wsInstance.prototype.send = function (data: any) {
        if (hookPrototype) {
            return originalSend.call(this, data);
        }
        if (!hookReceived) {
            logRecorder.info("WS Send Hook Start");
        }
        if (!hookPrototype && sendInterceptor) {
            data = sendInterceptor(data);
            if (data === undefined) return
        }
        if (String(this.url || '').includes(TARGET_URL) && !hookMap.has(this.url)) {
            hookReceived = true;
            hookMap.set(this.url, this);
            hookReceiveForInstance(this);
            if (this.readyState === originalWebSocket.OPEN) announceChatSocketReady(this)
            logRecorder.info("WS Send Hook Success");
        }
        return originalSend.call(this, data);
    };

    setTimeout(() => {
        if (!hookPrototype) {
            logRecorder.info("WS Send Hook install；wait ws send");
        }
    }, 500)
}

/**
 * Add receive hook for a specific WebSocket instance
 */
function hookReceiveForInstance(wsInstance: WebSocket) {
    if (observedSockets.has(wsInstance)) {
        return
    }
    observedSockets.add(wsInstance)
    // Observe passively so BOSS's own onmessage/addEventListener handlers remain untouched.
    wsInstance.addEventListener('message', (event: MessageEvent) => {
        const data = event.data
        if (Tools.window.Blob && data instanceof Tools.window.Blob) {
            data.arrayBuffer()
                .then((buffer: ArrayBuffer) => receiveInterceptor?.(buffer))
                .catch((error: unknown) => logRecorder.warn('读取聊天 Blob 消息失败', error))
            return
        }
        receiveInterceptor?.(data)
    })
}

/**
 * Initialize the complete WebSocket hooking system
 */
function setupCompleteWebSocketHook() {
    // Hook existing WebSockets (in case some were created before our hook)
    hookExistingWebSockets();
}

setupCompleteWebSocketHook()

//======================================================================================================================

// 设置拦截器函数
function setSendInterceptor(interceptor: (data: any) => any) {
    sendInterceptor = interceptor;
}

function setReceiveInterceptor(interceptor: (data: any) => any) {
    receiveInterceptor = interceptor;
}


// 设置发送消息拦截器
setSendInterceptor((data) => {
    logger.trace("发送消息原始数据：", data)
    let wsData: TechwolfChatProtocol = decodeMqttAndProtobuf(data, "发送") as TechwolfChatProtocol
    if (!(wsData && wsData?.messages.length >= 1)) {
        return data;
    }
    let msgText = String(getMsgBody(wsData) || '');
    let toUid = normalizeNumber(wsData.messages[0].to.uid);
    if (!toUid) {
        return data;
    }

    logger.debug("发送消息解码内容：", msgText)
    if (msgText.endsWith(Tools.getEndChar()) || filter(msgText, wsData)) {
        // ai消息，不做拦截；或者是投递之后自动发送的自定义招呼语
        return data;
    }

    // 不是 AI 发送的消息；用户手动介入后统一关闭该会话 AI。
    if (claimManualOutgoingEvent(wsData.messages[0], toUid, msgText)) {
        handleManualOutgoing(toUid)
    }
    return data;
});

function handleManualOutgoing(toUid: number): void {
    void (async () => {
        try {
            const bossUserInfo = BossOption.getBossUserInfoByCache(toUid)
                || await new BossOption().getBossUserInfoByBossId(toUid)
            if (!bossUserInfo) {
                logRecorder.warn(`手动介入未能定位联系人：bossId=${toUid}`)
                return
            }
            const response = await AiPower.updateAskStatus(
                BossOption.buildJobKey(bossUserInfo),
                true,
            )
            logRecorder.info(`[${bossUserInfo.jobTitle}] 手动介入关闭AI交流：${response.data.data}`)
        } catch (error) {
            logRecorder.error('手动介入关闭AI交流失败', error)
        }
    })()
}

let userConfigLoad: Promise<void> | null = null

async function handleReceivedChatData(data: any): Promise<void> {
    logger.trace("接收消息原始数据：", data)
    let wsData: TechwolfChatProtocol = decodeMqttAndProtobuf(data, "接收") as TechwolfChatProtocol
    await handleReceivedChatProtocol(wsData)
}

async function handleReceivedChatProtocol(wsData: TechwolfChatProtocol): Promise<void> {
    extractDeliveryConfirmations(wsData).forEach(({clientMid, serverMid}) => {
        Tools.window.AIJobHelperChatBridge?.confirm?.(clientMid, serverMid)
    })
    const messages = Array.isArray(wsData?.messages) ? wsData.messages : []
    for (const message of messages) {
        await handleSingleReceivedChatMessage({...wsData, messages: [message]})
    }
}

async function handleSingleReceivedChatMessage(wsData: TechwolfChatProtocol): Promise<void> {
    if (!(wsData && wsData?.messages.length >= 1)) {
        return;
    }
    const message = wsData.messages[0] as any
    let msgBody = String(getMsgBody(wsData) || '');
    let fromUid = normalizeNumber(message.from.uid);
    if (!fromUid) {
        return;
    }
    const ownMessage = normalizeNumber(Tools.window._PAGE?.uid) === fromUid
    try {
        const peerUid = ownMessage ? normalizeNumber(message.to?.uid) : fromUid
        if (peerUid) {
            const contact = BossOption.getBossUserInfoByCache(peerUid)
            const conversationKey = makeConversationKey(contact?.encryptBossId, contact?.securityId)
            appendRejectionMessage(conversationKey || peerUid, {
                messageId: normalizeProtocolId(message.mid ?? message.cmid),
                mid: normalizeProtocolId(message.mid),
                cmid: normalizeProtocolId(message.cmid),
                role: ownMessage ? 'USER' : 'HR',
                text: msgBody,
                timestamp: Number(message.time || Date.now()),
            })
        }
    } catch (_) {
        // 拒绝分析是旁路能力；缓冲失败绝不影响聊天 ACK 或 AI 回复主链。
    }
    if (ownMessage) {
        logger.debug("接收到自己的消息='" + msgBody + "'")
        let configuredGreeting = ''
        try {
            userStore ||= UserStore()
            configuredGreeting = String(userStore?.user?.preference?.cg || '')
        } catch (_) {
            // The explicit clientMid registry still identifies plugin messages
            // when Pinia has not completed its document-start initialization.
        }
        if (shouldHandleManualOutgoingEcho(message, msgBody, {
            automatedClientMid: isAutomatedOutgoingMessage(message),
            configuredGreeting,
            endChar: Tools.getEndChar(),
        })) {
            const toUid = normalizeNumber(message.to?.uid)
            if (toUid && claimManualOutgoingEvent(message, toUid, msgBody)) {
                handleManualOutgoing(toUid)
            }
        }
        return;
    }

    if (!userStore) {
        try {
            userStore = UserStore();
        } catch (error) {
            logRecorder.error("AI坐席无法读取用户配置", error)
            return
        }
    }

    // document-start 时聊天消息可能早于远程偏好加载。状态尚未知时短暂排队，
    // 而不是把第一条HR消息误判为“AI坐席关闭”。
    if (userStore?.user?.aiSeatStatus == null) {
        try {
            userConfigLoad ||= userRemoteLoad()
            await userConfigLoad
        } catch (error) {
            logRecorder.error("AI坐席加载用户配置失败，保留HR未读消息", error)
            return
        } finally {
            userConfigLoad = null
        }
    }
    if (!userStore?.user?.aiSeatStatus) {
        logger.info("AI坐席未开启结束-前置")
        return;
    }

    let bossOption: BossOption = new BossOption()
    await bossOption.handlerBossMessage(wsData, fromUid, msgBody)
}

// 设置接收消息拦截器
setReceiveInterceptor((data) => {
    void handleReceivedChatData(data).catch(error => {
        logRecorder.error("AI坐席处理HR消息失败", error)
    })
    return data;
});

//  todo 发送图片简历依赖image对象


let userStore: any;

/**
 * 是否是投递之后自动发送的自定义招呼语以及自定义图片简历
 * @param msg
 * @param wsData
 */
function filter(msg: string, wsData: any): boolean {
    if (!userStore) {
        userStore = UserStore();
    }
    if (msg === userStore?.user?.preference?.cg) {
        return true;
    }

    return wsData.messages[0]?.body?.image

}

}
