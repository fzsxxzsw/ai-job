import axiosOriginal from 'axios'
import {Message} from '../webSocket/protobuf'
import {Tools} from './utils'
import {getBossRiskStop, tripBossRiskCircuit} from './bossRiskControl'
import {recordDeliveryAudit, makeConversationKey} from './deliveryAudit'
import type {ActionReceipt, AutomationAction} from './unifiedAutomation'

export function unknownPlatformReceipt(): ActionReceipt {
    return {status: 'UNKNOWN', serverMid: null, platformCode: null, occurredAt: Date.now(), errorCode: 'PLATFORM_RESULT_UNKNOWN', executionPhase: 'PLATFORM_RESULT'}
}
export async function prepareUnifiedChat() {
    const bridge = Tools.window.AIJobHelperChatBridge
    if (!bridge?.isReady?.()) await bridge?.ensureReady?.(8000)
    if (!bridge?.isReady?.() || getBossRiskStop()) throw new Error('CHAT_NOT_READY')
}
/** Called only after the durable API dispatch permit. One platform invocation, never an inline retry. */
export async function performUnifiedText(contact: BossUserInfo, action: AutomationAction, clientMid: string | null): Promise<ActionReceipt> {
    if (!clientMid || !/^\d+$/.test(clientMid) || !action.payload.text || !['SEND_TEXT', 'SEND_GREETING'].includes(action.kind)
        || String(contact.bossId) !== action.payload.bossId || makeConversationKey(contact.encryptBossId, contact.securityId) !== action.payload.conversationKey
        || getBossRiskStop() || !Tools.window.AIJobHelperChatBridge?.isReady?.()) {
        return {status: 'FAILED', serverMid: null, platformCode: null, occurredAt: Date.now(), errorCode: 'AUTHORIZATION_CHANGED', executionPhase: 'BEFORE_PLATFORM_CALL'}
    }
    const message = new Message({form_uid: String(Tools.window._PAGE.uid), to_uid: String(contact.bossId),
        to_name: contact.encryptBossId, content: action.payload.text, image: undefined, clientMid})
    await message.send(1)
    const actualClientMid = String(message.msgObj.cmid || '')
    const directMid = String((message.msgObj as any).__serverMid || '')
    // SDK remapping is accepted only through the bridge's registered exact alias proof.
    const aliasAck = String(Tools.window.AIJobHelperChatBridge?.getAcknowledgement?.(clientMid) || '')
    const serverMid = actualClientMid === clientMid ? directMid || aliasAck : aliasAck
    const receipt = serverMid ? {status: 'ACKNOWLEDGED' as const, serverMid, platformCode: 0, occurredAt: Date.now(), errorCode: null} : unknownPlatformReceipt()
    recordDeliveryAudit({key: `graph:${action.actionId}`, kind: action.kind === 'SEND_GREETING' ? 'greeting' : 'ai-reply',
        status: receipt.status === 'ACKNOWLEDGED' ? 'acknowledged' : 'sending', jobTitle: contact.jobTitle,
        content: action.payload.text, bossId: contact.bossId, conversationKey: action.payload.conversationKey || undefined,
        clientMid, serverMid: receipt.serverMid || undefined})
    return receipt
}
export async function performUnifiedExchange(contact: BossUserInfo, action: AutomationAction): Promise<ActionReceipt> {
    if (action.approvalStatus !== 'APPROVED' || String(contact.bossId) !== action.payload.bossId
        || makeConversationKey(contact.encryptBossId, contact.securityId) !== action.payload.conversationKey || getBossRiskStop()) {
        return {status: 'FAILED', serverMid: null, platformCode: null, occurredAt: Date.now(), errorCode: 'AUTHORIZATION_CHANGED', executionPhase: 'BEFORE_PLATFORM_CALL'}
    }
    const acceptTypes = {ACCEPT_PHONE: 1, ACCEPT_WECHAT: 2, ACCEPT_RESUME: 4} as const
    const sendResume = action.kind === 'SEND_RESUME'
    if (!sendResume && !(action.kind in acceptTypes)) throw new Error('UNSUPPORTED_ACTION')
    const body = sendResume
        ? {securityId: contact.securityId, type: 3, encryptResumeId: action.payload.platformResumeId}
        : {securityId: contact.securityId, type: acceptTypes[action.kind as keyof typeof acceptTypes], mid: action.payload.requestMessageId,
            ...(action.kind === 'ACCEPT_RESUME' ? {encryptResumeId: action.payload.platformResumeId} : {})}
    try {
        const response = await axiosOriginal.post(`https://www.zhipin.com/wapi/zpchat/exchange/${sendResume ? 'request' : 'accept'}`, body,
            {headers: {'Zp_token': Tools.getCookieValue('bst'), 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'}, timeout: 8000})
        tripBossRiskCircuit(response)
        const code = response?.data?.code
        if (code === 0) return {status: 'ACKNOWLEDGED', serverMid: null, platformCode: 0, occurredAt: Date.now(), errorCode: null}
        if (typeof code === 'number') return {status: 'FAILED', serverMid: null, platformCode: code, occurredAt: Date.now(), errorCode: 'PLATFORM_REJECTED'}
        return unknownPlatformReceipt()
    } catch (error) { tripBossRiskCircuit(error); return unknownPlatformReceipt() }
}
