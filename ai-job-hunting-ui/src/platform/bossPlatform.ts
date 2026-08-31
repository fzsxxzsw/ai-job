import axiosOriginal from "axios";
import {Message, MessageRead, TechwolfChatProtocol} from "../webSocket/protobuf";
import {MessageCache, Tools} from "./utils";
import {UserStore} from '../stores'
import logging from "../logging";
import logger from "../logging";
import {LogRecorder} from "../logging/record";
import {BossOperationTypeEnum, JobSeekerClonedAnswerTypeEnum} from "../stores/types";
import {AiPower} from "./aiPower";
import {ElMessage} from "../utils/tools";
import {ElNotification} from "element-plus";
import {GM_getValue, GM_setValue} from "$";
import {
    hasBossDeliveryReceipt,
    makeConversationKey,
    readDeliveryAudit,
    recordDeliveryAudit,
    setConversationIdentityResolver,
    stableDeliveryKey,
} from "./deliveryAudit";
import {getBossRiskStop, tripBossRiskCircuit} from "./bossRiskControl";
import {
    findActiveReplyForInbound,
    deliveryScopeKey,
    findNextRetryableOutsideUnknownScopes,
    hasServerAcknowledgement,
    isDispatchUncertain,
    isExhaustedDelivery,
    isManualReviewDelivery,
    shouldMoveUncertainToManualReview,
} from "./deliveryQueue";
import {runWithOptionalDeliveryLock} from "./deliveryLock";
import {KeyedSerialExecutor} from "./keyedSerialExecutor";
import {CHAT_BRIDGE_READY_EVENT} from "../webSocket/chatDelivery";
import {
    EMPTY_AI_REPLY_RETRY_DELAY_MS,
    EMPTY_AI_REPLY_WARNING,
    normalizeSendableAiReply,
} from "./aiReplySafety";

let userStore = null as any;

type PendingAiReply = {
    key: string,
    bossId: number,
    jobTitle: string,
    content: string,
    createdAt: number,
    attempts: number,
    clientMid?: string,
    serverMid?: string,
    conversationKey?: string,
    acknowledgedAt?: number,
    dispatchedAt?: number,
    manualReviewAt?: number,
    inboundMessageId?: string,
    inboundMessageMid?: string,
    inboundTextKey?: string,
    recovered?: boolean,
}

type ConversationReplyState = {
    bossId: number,
    conversationKey: string,
    hrMessageId: string,
    hrReplyAt: number,
    updatedAt: number,
}

export class BossOption {

    static bossUserInfoMap: Map<number, BossUserInfo> = new Map();
    static logRecorder: LogRecorder = new LogRecorder('recorder');
    static messageCache = new MessageCache();
    private static readonly AI_REPLY_QUEUE_KEY = 'ai-job-pending-ai-replies-v1';
    private static readonly AI_REPLY_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    private static readonly AI_REPLY_RETRY_INTERVAL_MS = 15_000;
    private static readonly DOM_CATCH_UP_INTERVAL_MS = EMPTY_AI_REPLY_RETRY_DELAY_MS;
    private static readonly CONVERSATION_REPLY_LEDGER_KEY = 'ai-job-conversation-replies-v1';
    private static readonly CONVERSATION_REPLY_LEDGER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
    private static aiReplyRetryTimer: number | null = null;
    private static aiReplySendingKeys = new Set<string>();
    private static aiReplyDrainRunning = false;
    private static inboundMessageProcessingKeys = new Set<string>();
    private static conversationMessageExecutor = new KeyedSerialExecutor();
    private static domCatchUpTimer: number | null = null;
    private static domCatchUpRunning = false;

    static aiIconWebpBase64 = 'data:image/webp;base64,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';
    static template = `
<style>
.chat-container {
    max-width: 1000px;
    margin: 20px auto;
    font-family: Arial, sans-serif;
}

.message {
    display: flex;
    margin: 10px 0;
    align-items: start;
}

.message-user {
    justify-content: flex-start;
    margin-left: -70px;
}

.message-assistant {
    justify-content: flex-end;
    margin-right: -46px;
}

.avatar-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 15px;
    width: 65px;
}

.avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    object-fit: cover;
    margin-bottom: 5px;
}

.user-info {
    font-size: 10px;
    font-weight: bold;
    color: #666;
    text-align: center;
    line-height: 1.3;
    max-width: 65px;
    word-break: break-word;
}

.content {
    max-width: 80%;
    padding: 10px 8px;
    border-radius: 12px;
    line-height: 1.5;
    font-size: 10px;
}

.user-content {
    background: #f1f0f0;
    color: #333;
    margin-left: -20px;
}

.assistant-content {
    background: #96d1d1;
    color: #333;
    margin-right: -20px;
}
</style>

<div class="chat-container">
    <!-- 用户提问 -->
    <div class="message message-user">
        <div class="avatar-container">
            <img class="avatar" src="{{user_avatar}}" alt="提问者头像">
            <span class="user-info">{{user_name}}</span>
        </div>
        <div class="content user-content">
            {{user_question}}
        </div>
    </div>

    <!-- 助理回答 -->
    <div class="message message-assistant">
        <div class="content assistant-content">
            {{assistant_answer}}
        </div>
        <div class="avatar-container">
            <img class="avatar" src="{{assistant_avatar}}" alt="回答者头像">
            <span class="user-info">{{assistant_name}}</span>
        </div>
    </div>
</div>

<!-- 变量替换示例：
{{user_avatar}} → "https://example.com/user.jpg"
{{user_name}} → "张三"
{{user_question}} → "如何快速掌握响应式布局设计？需要具体的学习路线建议"
{{assistant_avatar}} → "https://example.com/bot.png"
{{assistant_name}} → "AI助手"
{{assistant_answer}} → "建议分三步学习：1. 掌握媒体查询... 2. 学习弹性盒子布局... 3. 实践栅格系统..."
-->
`;

    static {
        setConversationIdentityResolver((rowText: string) => {
            const info = this.findContactByRowText(rowText)
            const conversationKey = makeConversationKey(info?.encryptBossId, info?.securityId)
            if (!info?.bossId || !conversationKey) return null
            return {
                bossId: String(info.bossId),
                conversationKey,
                encryptBossId: String(info.encryptBossId),
                securityId: String(info.securityId),
                brandName: String(info.brandName || ''),
                positionTitle: String(info.positionTitle || ''),
                recruiterName: String(info.recruiterName || ''),
            }
        })
        this.loadRecentContact().then(_ => {
        });
        this.startDomCatchUpWorker();
        window.setTimeout(() => {
            try {
                // Resume persisted replies even when no new HR packet arrives after reload.
                new BossOption()
            } catch (error) {
                this.logRecorder.warn('AI坐席补发 worker 初始化失败', error)
            }
        }, 0)
    }

    constructor() {
        if (!userStore) {
            // 初次加载
            userStore = UserStore()
        }
        this.startAiReplyRetryWorker()
    }

    private readConversationReplyLedger(): Record<string, ConversationReplyState> {
        try {
            const gmRaw = GM_getValue(BossOption.CONVERSATION_REPLY_LEDGER_KEY, '') as string
            const localRaw = localStorage.getItem(BossOption.CONVERSATION_REPLY_LEDGER_KEY) || ''
            const parsed = JSON.parse(gmRaw || localRaw || '{}') as Record<string, ConversationReplyState>
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
            const now = Date.now()
            return Object.fromEntries(Object.entries(parsed).filter(([, state]) => state?.bossId
                && state?.conversationKey && state?.hrMessageId
                && now - Number(state.updatedAt || 0) < BossOption.CONVERSATION_REPLY_LEDGER_MAX_AGE_MS))
        } catch (_) {
            return {}
        }
    }

    private writeConversationReplyLedger(ledger: Record<string, ConversationReplyState>): void {
        const trimmed = Object.fromEntries(Object.entries(ledger)
            .sort((left, right) => Number(left[1]?.updatedAt || 0) - Number(right[1]?.updatedAt || 0))
            .slice(-300))
        const raw = JSON.stringify(trimmed)
        GM_setValue(BossOption.CONVERSATION_REPLY_LEDGER_KEY, raw)
        localStorage.setItem(BossOption.CONVERSATION_REPLY_LEDGER_KEY, raw)
    }

    private markHrReply(bossUserInfo: BossUserInfo, messageId: string): void {
        const conversationKey = makeConversationKey(bossUserInfo.encryptBossId, bossUserInfo.securityId)
        if (!conversationKey || !messageId) return
        const ledger = this.readConversationReplyLedger()
        const now = Date.now()
        ledger[conversationKey] = {
            bossId: bossUserInfo.bossId,
            conversationKey,
            hrMessageId: messageId,
            hrReplyAt: now,
            updatedAt: now,
        }
        this.writeConversationReplyLedger(ledger)
    }

    private hasSameConversationTwoWayReply(bossUserInfo: BossUserInfo): boolean {
        const conversationKey = makeConversationKey(bossUserInfo.encryptBossId, bossUserInfo.securityId)
        if (!conversationKey) return false
        const hrReply = this.readConversationReplyLedger()[conversationKey]
        if (!hrReply || hrReply.bossId !== bossUserInfo.bossId || !hrReply.hrReplyAt) return false
        return readDeliveryAudit().some(entry => entry.kind === 'greeting'
            && entry.status === 'receipt'
            && entry.bossId === String(bossUserInfo.bossId)
            && entry.conversationKey === conversationKey
            && !!entry.clientMid && !!entry.serverMid && !!entry.receiptAt)
    }

    private readAiReplyQueue(): PendingAiReply[] {
        try {
            const now = Date.now()
            const gmRaw = GM_getValue(BossOption.AI_REPLY_QUEUE_KEY, '') as string
            const localRaw = localStorage.getItem(BossOption.AI_REPLY_QUEUE_KEY) || ''
            const queue = JSON.parse(gmRaw || localRaw || '[]')
            if (!Array.isArray(queue)) {
                return []
            }
            return queue.filter((item: PendingAiReply) => item?.key
                && Number.isFinite(item?.bossId) && item.bossId > 0
                && item?.content
                && now - Number(item.createdAt || 0) < BossOption.AI_REPLY_QUEUE_MAX_AGE_MS)
                .slice(-100)
        } catch (error) {
            BossOption.logRecorder.warn('读取AI坐席补发队列失败，已忽略损坏数据')
            return []
        }
    }

    private writeAiReplyQueue(queue: PendingAiReply[]): void {
        try {
            const raw = JSON.stringify(queue.slice(-100))
            GM_setValue(BossOption.AI_REPLY_QUEUE_KEY, raw)
            localStorage.setItem(BossOption.AI_REPLY_QUEUE_KEY, raw)
        } catch (error) {
            BossOption.logRecorder.error('保存AI坐席补发队列失败')
        }
    }

    private enqueueAiReply(entry: PendingAiReply, lastError?: unknown): void {
        const queue = this.readAiReplyQueue().filter(item => item.key !== entry.key)
        queue.push(entry)
        this.writeAiReplyQueue(queue)
        recordDeliveryAudit({
            key: entry.key, kind: 'ai-reply', status: 'queued', jobTitle: entry.jobTitle,
            content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
            conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            lastError,
        })
    }

    /** Merge one reply into the latest shared queue snapshot while its send lock is held. */
    private persistAiReplyEntry(entry: PendingAiReply): void {
        const latest = this.readAiReplyQueue().filter(item => item.key !== entry.key)
        latest.push(entry)
        this.writeAiReplyQueue(latest)
    }

    private removeAiReplyFromQueue(key: string): void {
        this.writeAiReplyQueue(this.readAiReplyQueue().filter(item => item.key !== key))
    }

    private persistAiReplyFailure(entry: PendingAiReply, lastError?: unknown): void {
        entry.attempts += 1
        if (isExhaustedDelivery(entry)) {
            this.markAiReplyAsFailed(entry, lastError)
            return
        }
        // Replacing the entry moves it to the tail, so one unavailable conversation
        // cannot starve newer replies while all retain their original clientMid.
        this.enqueueAiReply(entry, lastError)
    }

    private markAiReplyAsFailed(entry: PendingAiReply, lastError?: unknown): void {
        this.removeAiReplyFromQueue(entry.key)
        recordDeliveryAudit({
            key: entry.key, kind: 'ai-reply', status: 'failed', jobTitle: entry.jobTitle,
            content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
            conversationKey: entry.conversationKey, clientMid: entry.clientMid,
            serverMid: entry.serverMid, lastError,
        })
        BossOption.logRecorder.error(`AI坐席回复连续发送失败，已结束该任务并解除新增沟通闸门：${entry.jobTitle}`)
    }

    /** Receipts and exhausted failures are terminal and cannot keep blocking new work. */
    private pruneSettledAiReplyQueue(queue = this.readAiReplyQueue()): PendingAiReply[] {
        const receiptKeys = new Set(readDeliveryAudit()
            .filter(entry => entry.kind === 'ai-reply' && entry.status === 'receipt')
            .map(entry => entry.key))
        const exhausted = queue.filter(entry => isExhaustedDelivery(entry))
        const exhaustedKeys = new Set(exhausted.map(entry => entry.key))
        const retained = queue.filter(entry => !receiptKeys.has(entry.key) && !exhaustedKeys.has(entry.key))
        if (retained.length !== queue.length) {
            this.writeAiReplyQueue(retained)
        }
        for (const entry of exhausted) {
            recordDeliveryAudit({
                key: entry.key, kind: 'ai-reply', status: 'failed', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid,
                serverMid: entry.serverMid, lastError: 'retry limit reached',
            })
        }
        return retained
    }

    private clearUnreadBadge(bossId: number): void {
        window.setTimeout(() => {
            const bossEleList = Array.from(document.querySelectorAll('.friend-content')) as any[]
            bossEleList.filter((bossEle: any) => bossId === bossEle?.__vue__?._props?.source?.uid)
                .forEach((bossEle: any) => bossEle.querySelectorAll('.notice-badge')
                    .forEach((badgeEle: Element) => badgeEle.remove()))
        }, 500)
    }

    private finalizeInboundMessage(
        bossId: number,
        inboundMessageId: string,
        inboundMessageMid: string | undefined,
        recovered: boolean,
    ): void {
        const alreadyProcessed = BossOption.messageCache.isMessageProcessed(bossId, inboundMessageId)
        if (!alreadyProcessed) {
            BossOption.messageCache.markMessageAsProcessed(
                bossId,
                inboundMessageId,
                recovered ? BossOption.AI_REPLY_QUEUE_MAX_AGE_MS : undefined,
            )
            if (!recovered && inboundMessageMid) {
                void new MessageRead({
                    userId: bossId as any,
                    messageId: inboundMessageMid as any,
                }).send()
            }
        }
        this.clearUnreadBadge(bossId)
    }

    private finalizeInboundMessageAfterAck(entry: PendingAiReply): boolean {
        if (!hasServerAcknowledgement(entry)) return false
        const prefix = `${entry.bossId}:`
        const inboundMessageId = entry.inboundMessageId
            || (entry.key.startsWith(prefix) ? entry.key.slice(prefix.length) : '')
        if (!inboundMessageId) return false
        this.finalizeInboundMessage(
            entry.bossId,
            inboundMessageId,
            entry.inboundMessageMid,
            !!entry.recovered,
        )
        return true
    }

    private async deliverPendingAiReply(entry: PendingAiReply, html?: string): Promise<boolean> {
        const lockScope = 'ai-reply-recipient'
        const lockIdentity = deliveryScopeKey(entry)
        const execution = await runWithOptionalDeliveryLock(
            (globalThis.navigator as any)?.locks,
            lockScope,
            lockIdentity,
            async () => {
                // Another BOSS tab may have ACKed, removed, or terminalized the
                // reply while this tab was waiting to acquire the lock.
                const current = this.readAiReplyQueue().find(item => item.key === entry.key)
                if (!current) return false
                Object.assign(entry, current)
                return await this.deliverPendingAiReplyLocked(entry, html)
            },
        )
        return execution.acquired ? !!execution.value : false
    }

    private async deliverPendingAiReplyLocked(entry: PendingAiReply, html?: string): Promise<boolean> {
        if (getBossRiskStop()) return false
        if (BossOption.aiReplySendingKeys.has(entry.key)) {
            return false
        }
        if (Tools.isHardBlockedCompany(entry.jobTitle)) {
            this.removeAiReplyFromQueue(entry.key)
            recordDeliveryAudit({
                key: entry.key, kind: 'ai-reply', status: 'blocked', jobTitle: entry.jobTitle,
                content: entry.content, bossId: entry.bossId, conversationKey: entry.conversationKey,
                clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            BossOption.logRecorder.warn(`【硬屏蔽】${entry.jobTitle}：已从AI坐席补发队列移除`)
            return false
        }
        if ((isDispatchUncertain(entry) || isManualReviewDelivery(entry)) && entry.clientMid) {
            const lateAck = Tools.window.AIJobHelperChatBridge?.getAcknowledgement?.(entry.clientMid)
            const lateServerMid = String(lateAck?.serverMid || '')
            if (!lateServerMid) {
                if (shouldMoveUncertainToManualReview(entry)) {
                    entry.manualReviewAt = Date.now()
                    this.persistAiReplyEntry(entry)
                    recordDeliveryAudit({
                        key: entry.key, kind: 'ai-reply', status: 'sending', jobTitle: entry.jobTitle,
                        content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                        conversationKey: entry.conversationKey, clientMid: entry.clientMid,
                        lastError: 'BOSS ACK missing; manual review required',
                    })
                    BossOption.logRecorder.warn(`AI坐席回复ACK长时间未返回，结果未知；已永久禁止自动重发并转人工核对：${entry.jobTitle}`)
                }
                return false
            }
            entry.clientMid = String(lateAck?.clientMid || entry.clientMid)
            entry.serverMid = lateServerMid
            entry.acknowledgedAt = Date.now()
            delete entry.manualReviewAt
            this.persistAiReplyEntry(entry)
            recordDeliveryAudit({
                key: entry.key, kind: 'ai-reply', status: 'acknowledged', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            BossOption.logRecorder.warn(`AI坐席回复已关联迟到的BOSS ACK，继续等待页面送达/已读回执：${entry.jobTitle}`)
            this.finalizeInboundMessageAfterAck(entry)
            return true
        }
        if (!entry.conversationKey) {
            try {
                const bossUserInfo = await this.getBossUserInfoByBossId(entry.bossId)
                entry.conversationKey = makeConversationKey(bossUserInfo?.encryptBossId, bossUserInfo?.securityId)
            } catch (error) {
                this.persistAiReplyFailure(entry, error)
                BossOption.logRecorder.warn(`AI坐席回复查询会话失败，稍后补发：${entry.jobTitle}`, error)
                return false
            }
            if (!entry.conversationKey) {
                this.persistAiReplyFailure(entry, 'unable to resolve conversation identity')
                BossOption.logRecorder.warn(`AI坐席回复无法绑定精确会话，稍后补发：${entry.jobTitle}`)
                return false
            }
            this.enqueueAiReply(entry)
        }
        const existingAudit = readDeliveryAudit().find(item => item.kind === 'ai-reply' && item.key === entry.key)
        const verifiedExistingReceipt = existingAudit?.status === 'receipt'
            && existingAudit.bossId === String(entry.bossId)
            && existingAudit.conversationKey === entry.conversationKey
            && !!existingAudit.clientMid && !!existingAudit.serverMid
        const deliveryIdentity = entry.clientMid && entry.serverMid
            ? {
                bossId: entry.bossId,
                conversationKey: entry.conversationKey,
                clientMid: entry.clientMid,
                serverMid: entry.serverMid,
            }
            : null
        if (verifiedExistingReceipt || (deliveryIdentity && hasBossDeliveryReceipt(entry.content, deliveryIdentity))) {
            this.removeAiReplyFromQueue(entry.key)
            recordDeliveryAudit({
                key: entry.key, kind: 'ai-reply', status: 'receipt', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            return true
        }
        // A server ACK is strong evidence that BOSS accepted this clientMid. Keep the
        // entry persisted for page 送达/已读 reconciliation without blocking newer work.
        // BOSS 已确认该 clientMid 后只等待可见回执，不因页面暂时没显示而重复发送。
        if (hasServerAcknowledgement(entry)) {
            return false
        }
        BossOption.aiReplySendingKeys.add(entry.key)
        try {
            if (!Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                await Promise.resolve(Tools.window.AIJobHelperChatBridge?.ensureReady?.(8_000))
            }
            if (!Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                return false
            }
            if (!entry.clientMid) {
                entry.clientMid = Message.createClientMid()
                this.enqueueAiReply(entry)
            }
            let confirmation: {serverMid: string, clientMid: string, uncertain?: boolean} | null
            try {
                confirmation = await this.sendMsg(entry.bossId, entry.content, undefined, html, entry.clientMid)
            } catch (error) {
                this.persistAiReplyFailure(entry, error)
                BossOption.logRecorder.warn(`AI坐席回复发送异常，稍后补发：${entry.jobTitle}`, error)
                return false
            }
            if (confirmation?.uncertain) {
                entry.clientMid = confirmation.clientMid
                entry.dispatchedAt = Date.now()
                this.persistAiReplyEntry(entry)
                recordDeliveryAudit({
                    key: entry.key, kind: 'ai-reply', status: 'sending', jobTitle: entry.jobTitle,
                    content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                    conversationKey: entry.conversationKey, clientMid: entry.clientMid,
                    lastError: 'SDK dispatch accepted; awaiting BOSS ACK',
                })
                BossOption.logRecorder.warn(`AI坐席回复已交给BOSS SDK，ACK暂未返回；已暂停重发以防重复消息：${entry.jobTitle}`)
                return false
            }
            if (confirmation) {
                entry.clientMid = confirmation.clientMid
                entry.serverMid = confirmation.serverMid
                entry.acknowledgedAt = Date.now()
                delete entry.manualReviewAt
                this.persistAiReplyEntry(entry)
                recordDeliveryAudit({
                    key: entry.key, kind: 'ai-reply', status: 'acknowledged', jobTitle: entry.jobTitle,
                    content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                    conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
                })
                BossOption.logRecorder.warn(`AI坐席消息已获服务器确认，等待页面送达/已读回执：${entry.jobTitle}`)
                return true
            }
            this.persistAiReplyFailure(entry, 'chat bridge did not acknowledge the message')
            return false
        } finally {
            BossOption.aiReplySendingKeys.delete(entry.key)
        }
    }

    private async drainAiReplyQueue(): Promise<void> {
        if (BossOption.aiReplyDrainRunning) return
        const queue = this.pruneSettledAiReplyQueue()
        if (getBossRiskStop()
            || !userStore?.user?.aiSeatStatus
            || !Tools.window.AIJobHelperChatBridge?.isReady?.()) return
        BossOption.aiReplyDrainRunning = true
        try {
            let hasUnresolvedDispatch = false
            for (const uncertain of queue.filter(entry =>
                isDispatchUncertain(entry) || isManualReviewDelivery(entry))) {
                if (!await this.deliverPendingAiReply(uncertain)
                    && isDispatchUncertain(uncertain)) {
                    hasUnresolvedDispatch = true
                }
            }
            // Keep later replies queued while one dispatch outcome is unknown.
            // This prevents an ACK outage from producing a batch of duplicate replies.
            if (hasUnresolvedDispatch) return
            const next = findNextRetryableOutsideUnknownScopes(
                queue,
                BossOption.aiReplySendingKeys,
            )
            if (next) {
                const acknowledged = await this.deliverPendingAiReply(next)
                if (acknowledged) this.finalizeInboundMessageAfterAck(next)
            }
        } finally {
            BossOption.aiReplyDrainRunning = false
        }
    }

    private startAiReplyRetryWorker(): void {
        if (BossOption.aiReplyRetryTimer !== null) {
            return
        }
        BossOption.aiReplyRetryTimer = window.setInterval(() => {
            void this.drainAiReplyQueue().catch(error => {
                BossOption.logRecorder.error('AI坐席后台补发任务失败', error)
            })
        }, BossOption.AI_REPLY_RETRY_INTERVAL_MS)
        Tools.window.addEventListener(CHAT_BRIDGE_READY_EVENT, () => {
            void this.drainAiReplyQueue().catch(error => {
                BossOption.logRecorder.error('消息通道就绪后的AI回复补发失败', error)
            })
        })
        if (Tools.window.AIJobHelperChatBridge?.isReady?.()) {
            void this.drainAiReplyQueue().catch(error => {
                BossOption.logRecorder.error('启动时AI回复补发失败', error)
            })
        }
    }

    /**
     * BOSS 聊天页在网络抖动、标签切换或自身重载期间，WebSocket Hook 可能错过一条
     * 已经落到联系人列表里的 HR 消息。仅依赖实时 WS 会导致该消息永远没有 AI 回复。
     *
     * 这里周期检查带未读角标的联系人预览，并用最近联系人缓存恢复 bossId。它只处理
     * 纯文本预览；简历附件、系统状态、草稿和本人的送达状态全部跳过。正常 WS 已处理
     * 的消息会被 MessageCache 去重，不会重复请求模型。
     */
    private static startDomCatchUpWorker(): void {
        if (this.domCatchUpTimer !== null) {
            return
        }
        this.domCatchUpTimer = window.setInterval(() => {
            void this.catchUpUnreadTextMessages().catch(error => {
                BossOption.logRecorder.error('AI坐席未读消息兜底检查失败', error)
            })
        }, this.DOM_CATCH_UP_INTERVAL_MS)
    }

    private static isRecoverableUnreadPreview(text: string): boolean {
        const normalized = (text || '').trim()
        if (!normalized || normalized.length < 2 || normalized.length > 500) {
            return false
        }
        return !/\[草稿\]|\[送达\]|\[已读\]|您正在与Boss|\.pdf\b|附件简历|已发送给|对方已同意|滚动加载更多/i.test(normalized)
    }

    private static normalizeContactText(value: unknown): string {
        return String(value || '').normalize('NFKC').replace(/[\s·|｜_—–-]+/g, '').toLowerCase()
    }

    private static contactParts(info: BossUserInfo): {brand: string, position: string, recruiter: string} {
        if (info.brandName || info.positionTitle || info.recruiterName) {
            return {
                brand: String(info.brandName || ''),
                position: String(info.positionTitle || ''),
                recruiter: String(info.recruiterName || ''),
            }
        }
        const parts = String(info.jobTitle || '').split('-').map(part => part.trim()).filter(Boolean)
        return {
            brand: parts[0] || '',
            position: parts.slice(1, -1).join('-'),
            recruiter: parts.at(-1) || '',
        }
    }

    private static identityTokenMatches(row: string, value: string, allowPrefix: boolean): boolean {
        const token = this.normalizeContactText(value)
        if (!token) return false
        if (row.includes(token)) return true
        // 公司名在联系人列表可能以省略号截断；必须至少四个字符且还要结合招聘者姓名，
        // 不能用过短前缀单独命中。
        return allowPrefix && token.length >= 6 && row.includes(token.slice(0, 4))
    }

    public static findContactByRowText(rowText: string): BossUserInfo | undefined {
        const normalizedRow = this.normalizeContactText(rowText)
        if (!normalizedRow) return undefined
        const scored = Array.from(this.bossUserInfoMap.values()).map(info => {
            const parts = this.contactParts(info)
            const brandMatched = this.identityTokenMatches(normalizedRow, parts.brand, true)
            const recruiterMatched = this.identityTokenMatches(normalizedRow, parts.recruiter, false)
            const positionMatched = this.identityTokenMatches(normalizedRow, parts.position, false)
            return {
                info,
                // 公司+招聘者是联系人行最稳定的组合；职位通常不会显示，只作为额外加分。
                score: (brandMatched ? 5 : 0) + (recruiterMatched ? 5 : 0) + (positionMatched ? 2 : 0),
                strong: brandMatched && recruiterMatched,
            }
        }).filter(item => item.strong)
            .sort((left, right) => right.score - left.score)
        if (scored.length === 0) return undefined
        if (scored.length > 1 && scored[0].score === scored[1].score) return undefined
        return scored[0].info
    }

    public static getUnreadRecoveryHealth(): {total: number, recoverable: number, unresolved: number, obscured: number} {
        const rows = Array.from(document.querySelectorAll('li')).filter(row =>
            row.querySelector('.notice-badge, [class*="notice-badge"], [class*="unread"]')
        ) as HTMLElement[]
        const health = {total: 0, recoverable: 0, unresolved: 0, obscured: 0}
        for (const row of rows) {
            const badge = row.querySelector('.notice-badge, [class*="notice-badge"], [class*="unread"]')
            const count = Math.max(1, Number((badge?.textContent || '').trim()) || 1)
            const rowText = (row.innerText || row.textContent || '').trim()
            const preview = (row.querySelector('.last-msg-text')?.textContent || '').trim()
            health.total += count
            if (!this.isRecoverableUnreadPreview(preview)) {
                health.obscured += count
            } else if (!this.findContactByRowText(rowText)) {
                health.unresolved += count
            } else {
                health.recoverable += count
            }
        }
        return health
    }

    private static async catchUpUnreadTextMessages(): Promise<void> {
        if (getBossRiskStop()) return
        if (this.domCatchUpRunning || !location.pathname.includes('/web/geek/chat')) {
            return
        }
        try {
            if (!userStore) {
                try {
                    userStore = UserStore()
                } catch (_) {
                    return
                }
            }
            if (!userStore?.user?.aiSeatStatus) {
                return
            }

            this.domCatchUpRunning = true
            const unreadRows = Array.from(document.querySelectorAll('li')).filter(row =>
                row.querySelector('.notice-badge, [class*="notice-badge"], [class*="unread"]')
            ) as HTMLElement[]
            const option = new BossOption()
            for (const row of unreadRows.slice(0, 10)) {
                const rowText = (row.innerText || row.textContent || '').trim()
                const preview = (row.querySelector('.last-msg-text')?.textContent || '').trim()
                if (!this.isRecoverableUnreadPreview(preview)) {
                    continue
                }
                const contact = this.findContactByRowText(rowText)
                if (!contact) {
                    continue
                }
                if (Tools.isHardBlockedCompany(contact.jobTitle, rowText)) {
                    this.logRecorder.warn(`【硬屏蔽】${contact.jobTitle}：跳过未读消息追赶`)
                    continue
                }
                await option.handlerRecoveredTextMessage(contact, preview)
            }
        } catch (error) {
            this.logRecorder.warn('AI坐席未读消息追赶失败，将继续重试', error)
        } finally {
            this.domCatchUpRunning = false
        }
    }

    /**
     * 前置回复boss消息
     * 针对boss发起的简历，联系方式，微信等需求，用于回复简历，联系方式，微信等
     */
    public async preReplyMsg(msgObj: TechwolfChatProtocol, bossUserInfo: BossUserInfo, text: string): Promise<any> {
        let type;
        if (text.includes("交换微信")) {
            type = 2
        } else if (text.includes("交换联系方式") || text.includes("我想要一个您的电话号码，您是否同意")) {
            type = 1
            // todo 开发中不给手机号
            // return;
        } else if (text.includes("我想要一份您的附件简历，您是否同意")) {
            type = 4
        } else if (text.includes("是否接受此工作地点")) {
            // 目前工作地点不处理
            return;
        } else if (text.includes("您对本职位的求职过程满意吗")) {
            return;
        } else {
            logger.info("【处理Boss消息-失败】未知类型消息", text)
        }
        let mid = msgObj.messages[0].mid as any;
        axiosOriginal.post("https://www.zhipin.com/wapi/zpchat/exchange/accept", {
            securityId: bossUserInfo.securityId,
            type: type,
            mid: mid.toString(),
            ...(type === 4 ? {encryptResumeId: userStore.user.resumeId} : {})
        }, {
            headers: {
                "Zp_token": Tools.getCookieValue("bst"),
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
            }
        }).then(response => {
            const risk = tripBossRiskCircuit(response)
            if (risk) BossOption.logRecorder.error(`BOSS风控熔断：${risk.reason}`)
        }).catch(error => {
            const risk = tripBossRiskCircuit(error)
            if (risk) BossOption.logRecorder.error(`BOSS风控熔断：${risk.reason}`)
        })
    }

    public preHandlerMsgByBodyType(msgObj: TechwolfChatProtocol, bossUserInfo: BossUserInfo, text: string): boolean {
        const bodyType = msgObj.messages[0].body.type;

        switch (bodyType) {
            // boss索要简历，联系方式，微信，发送地址【工作地点是否接受】（直接前端处理）
            case 7:
                logging.debug("【处理Boss消息】boss索要简历，联系方式，微信", text, msgObj)
                this.preReplyMsg(msgObj, bossUserInfo, text).then()
                return false;
            // 12 页面显示的预览简历提示，过滤
            case 12:
            case 4:
            case 8:
            // 约面的消息（1-3-14）：过滤，用户处理
            case 14:
                // 过滤boss打招呼的前置系统消息
                logging.debug("【处理Boss消息】系统消息", text, msgObj)
                return false;
            case 1:
                // 为：普通交流文本消息； 过滤boss索要微信，联系方式，然后在上面(case 7)前置处理后。boss的消息回复提示
                if (text.includes("&lt;/phone&gt;") || text.includes("&lt;/copy&gt;")) {
                    logging.debug("【处理Boss消息】过滤处理过的索要联系方式消息", text, msgObj)
                    return false;
                }
                // 为：普通交流文本消息； 过滤hr拒绝简历的普通消息
                if (text.includes("对方拒绝了您的发送请求")) {
                    logging.debug("【处理Boss消息】hr拒绝简历的普通消息", text, msgObj)
                    return false;
                }
                if (text === "方便发一份简历过来吗？") {
                    // 还有另外一个消息专门请求简历，这里过滤掉
                    return false;
                }
        }

        return !!text;

    }

    public preHandlerMsgByMsgType(msgObj: TechwolfChatProtocol, text: string): boolean {
        const msgType = msgObj.messages[0].type;

        switch (msgType) {
            case 1:
                // boss发送过来的普通文本消息
                return true;
            case 3:
                // boss的打招呼消息 (不仅是打招呼，还有其他消息,q目前知道的有询问接受地址)
                // 【还有发送简历之后页面显示的预览简历信息；以及发送简历请求后hr拒绝接受简历的普通消息】这些都应该是需要直接在这里过滤的。现在先在后面的bodyType中过滤掉
                // logging.debug("【处理Boss消息-忽略】boss打招呼消息", text)
                // return false;
                return true;
            case 4:
                // boss系统提示消息
                logging.debug("【处理Boss消息-忽略】boss系统提示消息", text)
                return false;
            default:
                return true;
        }
    }

    public buildNoticeHtml(fromName: string, fromAvatar: string, question: string, answer: string) {
        return BossOption.template
            .replace(/{{user_name}}/g, fromName)
            .replace(/{{user_avatar}}/g, fromAvatar)
            .replace(/{{user_question}}/g, question)
            .replace(/{{assistant_name}}/g, 'AI助手')
            .replace(/{{assistant_answer}}/g, answer)
            .replace(/{{assistant_avatar}}/g, BossOption.aiIconWebpBase64)
    }

    /**
     * 附件简历属于有副作用的 BOSS 操作，不能只相信模型给出的 operationType。
     * 仅当 HR 文本明确索要简历时放行；拒绝、不匹配等消息即使被模型误判，
     * 也必须在浏览器端最终拦截。
     */
    private shouldSendResumeForMessage(text: string): boolean {
        const normalized = (text || '').replace(/\s+/g, '')
        const rejection = /(不合适|不匹配|不太匹配|不符合|拒绝|无需|不用|暂不|不考虑|祝.*求职|更好的机会)/
        const explicitRequest = /(发|发送|提供|投递|方便发|可以发|能否发|请发|来一份|看一下|看看).{0,8}(附件)?简历|简历.{0,8}(发|发送|提供|投递|方便|可以|能否|请)/
        return !rejection.test(normalized) && explicitRequest.test(normalized)
    }

    public async handlerRecoveredTextMessage(contact: BossUserInfo, text: string): Promise<void> {
        const stableMid = `dom:${contact.bossId}:${text.slice(0, 80)}`
        const recoveredMessage = {
            messages: [{
                mid: stableMid,
                type: 1,
                body: {type: 1},
                from: {
                    uid: contact.bossId,
                    name: contact.jobTitle.split('-').slice(-1)[0] || 'Boss',
                    avatar: '',
                },
            }],
        } as unknown as TechwolfChatProtocol
        BossOption.logRecorder.info(`AI坐席追赶未读消息：${contact.jobTitle} - ${text}`)
        await this.handlerBossMessage(recoveredMessage, contact.bossId, text, true)
    }

    public handlerBossMessage(msgObj: TechwolfChatProtocol, bossId: number, text: string, recovered = false): Promise<void> {
        // One recruiter can emit several messages before the first AI request returns.
        // Keep that conversation ordered so context updates and outgoing replies cannot race.
        return BossOption.conversationMessageExecutor.run(String(bossId), () =>
            this.handleBossMessage(msgObj, bossId, text, recovered))
    }

    private async handleBossMessage(msgObj: TechwolfChatProtocol, bossId: number, text: string, recovered = false): Promise<void> {
        if (getBossRiskStop()) return
        if (userStore.user.preference.drE && userStore.user.preference.dr > 0) {
            // 延迟回复
            await Tools.sleep(userStore.user.preference.dr * 1000 + Tools.getRandomNumber(0, 300))
        }
        const rawMessageId: any = msgObj.messages[0]?.mid
        const inboundMessageMid = rawMessageId != null
            ? String(rawMessageId?.toString?.() || rawMessageId)
            : undefined
        const inboundMessageId = inboundMessageMid
            || `text:${stableDeliveryKey(String(bossId), text)}`
        const inboundTextKey = stableDeliveryKey(
            String(bossId),
            String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 32),
        )
        const processingKey = `${bossId}:${inboundMessageId}`
        if (BossOption.messageCache.isMessageProcessed(bossId, inboundMessageId)
            || BossOption.inboundMessageProcessingKeys.has(processingKey)) {
            logging.trace("【跳过重复消息】:", processingKey);
            return;
        }
        BossOption.inboundMessageProcessingKeys.add(processingKey)
        try {
            // 用户ai坐席未开启：不落去重记录，以便重新开启后追赶未读。
            if (!userStore.user.aiSeatStatus) {
                logger.info("AI坐席未开启，不处理消息")
                return;
            }

            if (!this.preHandlerMsgByMsgType(msgObj, text)) {
                BossOption.messageCache.markMessageAsProcessed(bossId, inboundMessageId)
                return;
            }

            const bossUserInfo = await this.getBossUserInfoByBossId(bossId);
            if (!bossUserInfo) {
                const bodyType = msgObj.messages[0].body.type;
                // 15 => 过滤活动通知
                if (bodyType === 15) {
                    BossOption.messageCache.markMessageAsProcessed(bossId, inboundMessageId)
                    return;
                }
                BossOption.logRecorder.error("【处理Boss消息-失败】无法获取联系人信息", text)
                return;
            }

            // 潮一相关联系人永久禁用 AI 坐席：不请求 AI、不自动发消息、不执行发送简历等动作。
            if (Tools.isHardBlockedCompany(bossUserInfo.jobTitle)) {
                const jobKey = BossOption.buildJobKey(bossUserInfo)
                BossOption.logRecorder.warn(`【硬屏蔽】潮一相关联系人 ${bossUserInfo.jobTitle}：不启用 AI 自动回复`)
                AiPower.updateAskStatus(jobKey, true).catch(() => undefined)
                BossOption.messageCache.markMessageAsProcessed(bossId, inboundMessageId,
                    BossOption.AI_REPLY_QUEUE_MAX_AGE_MS)
                return;
            }

            if (!this.preHandlerMsgByBodyType(msgObj, bossUserInfo, text)) {
                BossOption.messageCache.markMessageAsProcessed(bossId, inboundMessageId)
                return;
            }
            this.markHrReply(bossUserInfo, inboundMessageId)
            logger.debug("接收消息解码内容：", text)

            // A live WS message and its later DOM preview use different synthetic ids.
            // Match by the stable inbound text key so DOM catch-up waits for the already
            // generated reply instead of asking the backend a second time. After the
            // seven-day queue TTL expires, readAiReplyQueue drops it and recovery resumes.
            const activeReply = findActiveReplyForInbound(
                this.readAiReplyQueue(),
                bossId,
                inboundMessageId,
                recovered ? inboundTextKey : '',
                Number.POSITIVE_INFINITY,
            )
            if (activeReply) {
                if (hasServerAcknowledgement(activeReply)) {
                    this.finalizeInboundMessageAfterAck(activeReply)
                } else {
                    BossOption.logRecorder.warn(`AI坐席回复仍在等待服务器确认，保留未读并继续补发：${bossUserInfo.jobTitle}`)
                }
                return
            }

            const jobKey = BossOption.buildJobKey(bossUserInfo);
            const resp = await AiPower.ask(text, jobKey, bossUserInfo)
            const data = resp.data.data;
            const answerTypeList: Number[] = data?.answerTypeList || [];

            // 停止交互
            if (answerTypeList.includes(JobSeekerClonedAnswerTypeEnum.STOP)) {
                logging.info("【处理Boss消息-忽略】停止交互")
                BossOption.messageCache.markMessageAsProcessed(bossId, inboundMessageId)
                return;
            }
            // ai服务异常
            if (answerTypeList.includes(JobSeekerClonedAnswerTypeEnum.AI_SERVICE_EXCEPTION)) {
                logging.info("AI服务异常，暂时无法处理消息")
                ElMessage({
                    type: 'error',
                    message: 'AI服务异常，暂时无法处理消息（请联系管理员处理）',
                })
                return;
            }

            let replyAcknowledged = false
            let replyForInbound: PendingAiReply | undefined
            // 文本回复
            if (answerTypeList.includes(JobSeekerClonedAnswerTypeEnum.MSG_TEXT)) {
                const answerContent = normalizeSendableAiReply(data?.answerContent)
                if (answerContent === null) {
                    // 不构建通知、不落补发队列、不触发发送，也不标记已读/已处理。
                    // DOM 未读追赶 worker 会在固定间隔后重新请求 AI。
                    BossOption.logRecorder.warn(EMPTY_AI_REPLY_WARNING)
                    return
                }
                const html = this.buildNoticeHtml(msgObj.messages[0]?.from?.name, msgObj.messages[0]?.from?.avatar, text, answerContent)
                const replyKey = `${bossId}:${inboundMessageId}`
                const existingReply = this.readAiReplyQueue().find(item => item.key === replyKey)
                const reply: PendingAiReply = existingReply || {
                    key: replyKey,
                    bossId,
                    jobTitle: bossUserInfo.jobTitle,
                    content: answerContent + Tools.getEndChar(),
                    createdAt: Date.now(),
                    attempts: 0,
                    clientMid: Message.createClientMid(),
                    conversationKey: makeConversationKey(bossUserInfo.encryptBossId, bossUserInfo.securityId),
                    inboundMessageId,
                    inboundMessageMid,
                    inboundTextKey,
                    recovered,
                }
                // 先落盘再发送；重试同一 HR serverMid 时复用同一 clientMid，禁止重复回复。
                if (!existingReply) this.enqueueAiReply(reply)
                replyForInbound = reply
                const sent = await this.deliverPendingAiReply(reply, html)
                replyAcknowledged = sent && hasServerAcknowledgement(reply)
                if (!sent) {
                    BossOption.logRecorder.warn(`AI坐席回复已生成并进入补发队列：${bossUserInfo.jobTitle}`)
                }
            }
            // boss操作
            let requiredOperationSucceeded = true
            if (answerTypeList.includes(JobSeekerClonedAnswerTypeEnum.BOSS_OPERATION)
                && data?.operationTypeList?.includes(BossOperationTypeEnum.SEND_RESUME)) {
                if (this.shouldSendResumeForMessage(text)) {
                    requiredOperationSucceeded = await this.sendResumeFile(bossId)
                } else {
                    BossOption.logRecorder.warn(`AI模型建议发送简历，但HR未明确索要或消息包含拒绝语义，已阻止：${bossUserInfo.jobTitle}`)
                }
            }

            // 持久化入队不等于发送成功。只有取得 BOSS serverMid（或本轮无需文本回复）
            // 且必需操作成功，才能标 processed、发已读并清除 DOM 未读角标。
            const textReplyRequired = answerTypeList.includes(JobSeekerClonedAnswerTypeEnum.MSG_TEXT)
            const processedDurably = (!textReplyRequired || replyAcknowledged) && requiredOperationSucceeded
            if (!processedDurably) return
            if (textReplyRequired && replyForInbound) {
                this.finalizeInboundMessageAfterAck(replyForInbound)
            } else {
                this.finalizeInboundMessage(bossId, inboundMessageId, inboundMessageMid, recovered)
            }
        } finally {
            BossOption.inboundMessageProcessingKeys.delete(processingKey)
        }
    }

    public async sendMsg(bossId: number, msg: string, image: {
        originImage: string,
        tinyImage: string
    } | undefined, html?: string, clientMid?: string): Promise<{
        serverMid: string,
        clientMid: string,
        uncertain?: boolean,
    } | null> {
        const bossUserInfo = await this.getBossUserInfoByBossId(bossId)
        if (!bossUserInfo) {
            BossOption.logRecorder.error("发送消息失败，联系人信息获取失败");
            return null;
        }

        if (Tools.isHardBlockedCompany(bossUserInfo.jobTitle)) {
            BossOption.logRecorder.warn(`【硬屏蔽】禁止向潮一相关联系人发送 AI 消息：${bossUserInfo.jobTitle}`)
            return null;
        }

        // 构建消息并等待真实聊天通道确认接收发送任务。
        let message = new Message({
            form_uid: Tools.window._PAGE.uid.toString(),
            to_uid: bossId.toString(),
            to_name: bossUserInfo.encryptBossId,
            content: msg,
            image: undefined,
            clientMid,
        });
        // One side-effecting attempt is enough here. Once the SDK accepts the write,
        // a missing ACK becomes an uncertain persisted state and is never resent blindly.
        const requestedClientMid = String(clientMid || message.msgObj.cmid || '')
        const sent = await message.send(1)
        const actualClientMid = String(message.msgObj.cmid || requestedClientMid)
        if (!sent) {
            const dispatchedAt = Number((message.msgObj as any).__dispatchedAt || 0)
            if (dispatchedAt > 0 || (requestedClientMid && actualClientMid !== requestedClientMid)) {
                BossOption.logRecorder.warn("AI坐席消息已交给BOSS SDK但未取得ACK；已进入未确认状态并暂停重发")
                return {serverMid: '', clientMid: actualClientMid, uncertain: true}
            }
            BossOption.logRecorder.error("AI坐席消息发送失败：聊天通道未就绪")
            return null
        }

        const serverMid = String((message.msgObj as any).__serverMid || '')
        if (!serverMid) {
            BossOption.logRecorder.error("AI坐席消息发送失败：未取得BOSS serverMid")
            return null
        }

        BossOption.logRecorder.info(`AI坐席消息发送通道已确认：${bossUserInfo.jobTitle}`)
        if (html) {
            ElNotification({
                type: 'info',
                title: 'AI坐席回复已获服务器确认',
                showClose: false,
                duration: 2000,
                dangerouslyUseHTMLString: true,
                message: html,
            })
        }
        return {serverMid, clientMid: actualClientMid}
    }

    public async sendResumeFile(bossId: number): Promise<boolean> {
        if (getBossRiskStop()) return false
        let resumeId = userStore.user.resumeId;
        if (!resumeId) {
            BossOption.logRecorder.warn("发送简历失败：未配置附件简历")
            return false;
        }

        const bossUserInfo = await this.getBossUserInfoByBossId(bossId)
        if (!bossUserInfo) {
            BossOption.logRecorder.error("发送简历失败，联系人信息获取失败");
            return false;
        }

        if (Tools.isHardBlockedCompany(bossUserInfo.jobTitle)) {
            BossOption.logRecorder.warn(`【硬屏蔽】禁止向潮一相关联系人自动发送简历：${bossUserInfo.jobTitle}`)
            return false;
        }

        if (!this.hasSameConversationTwoWayReply(bossUserInfo)) {
            BossOption.logRecorder.warn(`发送简历已暂停：同一会话尚未同时具备“我方招呼语已送达/已读 + HR已回复”：${bossUserInfo.jobTitle}`)
            return false
        }

        try {
            const response = await axiosOriginal.post("https://www.zhipin.com/wapi/zpchat/exchange/request", {
                securityId: bossUserInfo.securityId,
                type: 3,
                encryptResumeId: resumeId
            }, {
                headers: {
                    "Zp_token": Tools.getCookieValue("bst"),
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
                }
            })
            const code = Number(response?.data?.code)
            const responseRisk = tripBossRiskCircuit(response)
            if (responseRisk) {
                BossOption.logRecorder.error(`BOSS风控熔断：${responseRisk.reason}`)
                return false
            }
            if (code !== 0) {
                BossOption.logRecorder.error(`AI坐席发送简历失败：${bossUserInfo.jobTitle} - ${response?.data?.message || '未知业务错误'}`)
                return false
            }
            BossOption.logRecorder.info(`AI坐席发送简历成功：${bossUserInfo.jobTitle}`)
            return true
        } catch (error: any) {
            const risk = tripBossRiskCircuit(error)
            if (risk) BossOption.logRecorder.error(`BOSS风控熔断：${risk.reason}`)
            BossOption.logRecorder.error(`AI坐席发送简历失败：${bossUserInfo.jobTitle}`, error?.message || error)
            return false
        }


    }

    public static getJobKeyByCache(bossId: number): string {
        let bossUserInfo = BossOption.getBossUserInfoByCache(bossId);
        if (!bossUserInfo) {
            return '';
        }
        return this.buildJobKey(bossUserInfo);
    }

    public static getBossUserInfoByCache(bossId: number): BossUserInfo | undefined {
        return BossOption.bossUserInfoMap.get(bossId);
    }

    public static buildJobKey(bossUserInfo: BossUserInfo): string {
        if (!bossUserInfo) {
            return '';
        }

        return bossUserInfo.encryptJobId + ":" + Tools.window._PAGE.uid;
    }


    public static async loadRecentContact(): Promise<void> {
        if (getBossRiskStop()) return
        // 加载最近30天内联系人
        this.obtainRecentContactBossId()
            .then(bossIdList => this.obtainBossUserInfo(bossIdList))
            .then(bossUserInfoList => {
                bossUserInfoList.forEach((bossUserInfo: BossUserInfo) => {
                    this.bossUserInfoMap.set(bossUserInfo.bossId, bossUserInfo);
                })
            }).catch(e => {
            const risk = tripBossRiskCircuit(e)
            if (risk) BossOption.logRecorder.error(`BOSS风控熔断：${risk.reason}`)
            logging.error("加载最近联系人失败", e)
        })
    }

    public async getBossUserInfoByBossId(bossId: number): Promise<BossUserInfo | undefined> {
        // 先从缓存中获取
        let bossUserInfo = BossOption.bossUserInfoMap.get(bossId);
        if (bossUserInfo) {
            return bossUserInfo;
        }

        // 调用接口获取
        let bossUserInfoList = await BossOption.obtainBossUserInfo([bossId]);
        if (bossUserInfoList.length === 0) {
            return undefined;
        }
        // 添加到缓存
        BossOption.bossUserInfoMap.set(bossId, bossUserInfoList[0]);
        return bossUserInfoList[0];
    }

    public static async obtainRecentContactBossId(): Promise<number[]> {
        if (getBossRiskStop()) return []
        let resp = await axiosOriginal.get("https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel?labelId=0")
        const responseRisk = tripBossRiskCircuit(resp)
        if (responseRisk) return []
        if (resp.data.message === '当前登录状态已失效') {
            throw new Error("未登录Boss");
        }
        let friendList: any = resp.data.zpData?.friendList;
        if (!friendList || !friendList?.length || friendList?.length === 0) {
            return [];
        }
        return friendList.map((friend: any) => friend.friendId);
    }

    public static async obtainBossUserInfo(bossIdList: number[]): Promise<BossUserInfo[]> {
        if (getBossRiskStop()) return []
        if (bossIdList && bossIdList.length && bossIdList.length >= 200) {
            // 超过199接口会报错
            bossIdList = bossIdList.slice(0, 199);
        }
        let bossIdListStr = bossIdList.map((bossId: any) => bossId.toString()).join(',');
        let resp: any = await axiosOriginal.get("https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json?friendIds=" + bossIdListStr)
        const responseRisk = tripBossRiskCircuit(resp)
        if (responseRisk) return []
        let friendList = resp.data.zpData?.result
        if (!friendList || friendList.length === 0) {
            return [];
        }
        return friendList.map((friend: any) => {
            return {
                bossId: friend.uid,
                encryptBossId: friend.encryptBossId,
                securityId: friend.securityId,
                encryptJobId: friend.encryptJobId,
                jobTitle: friend.brandName + "-" + friend.title + "-" + friend.name,
                brandName: friend.brandName,
                positionTitle: friend.title,
                recruiterName: friend.name,
            } as BossUserInfo;
        });
    }

}
