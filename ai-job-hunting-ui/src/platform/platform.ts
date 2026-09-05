import {
    AiDecisionUnknownExp,
    FetchJobBossFailExp,
    JobDetailUnavailableExp,
    NotMatchException,
    PlatformError,
    PublishLimitExp,
    PublishStopExp,
    PushReqException
} from "../exp";
import {scrollElementToBottom, simulateScrollToEnd, TampermonkeyApi, Tools} from "./utils";
import logger, {LogLevel} from '../logging'
import axiosOriginal from "axios";
import {PushResultStatus, PushStatus} from "../enums";
import {Message} from "../webSocket/protobuf";
import {LogRecorder} from "../logging/record";
import {pushResultCount, UserStore} from "../stores";
import {userRemoteLoad} from "../stores/remote";
import {AiPower} from "./aiPower";
import {GM_addValueChangeListener, GM_getValue, GM_setValue} from "$";
import {
    conversationIdentityFromElement,
    hasBossDeliveryReceipt,
    makeConversationKey,
    readDeliveryAudit,
    reconcileDeliveryAuditFromDom,
    recordDeliveryAudit,
} from "./deliveryAudit";
import {getBossRiskStop, tripBossRiskCircuit} from "./bossRiskControl";
import {detectBossDailyLimit, isLegacyLocalDailyLimit, makeBossDailyLimitKey} from "./bossDailyLimit";
import {
    BOSS_LAST_PUSH_AT_KEY,
    calculatePushCooldownMs,
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from "./safetyLimits";
import {
    canRetryAfterConfirmedUngreeted,
    countDeliveryGateBlockers,
    deliveryScopeKey,
    findExhaustedDeliveries,
    findNextRetryableOutsideUnknownScopes,
    hasDeliveryGateTimedOut,
    hasServerAcknowledgement,
    isDispatchUncertain,
    isExhaustedDelivery,
    isManualReviewDelivery,
    RetryQueueEntry,
    shouldMoveUncertainToManualReview,
} from "./deliveryQueue";
import {runWithOptionalDeliveryLock} from "./deliveryLock";
import {CHAT_BRIDGE_READY_EVENT} from "../webSocket/chatDelivery";
import {collectBossJobs} from "./boss/jobSourceAdapter";
import {BossContractError, buildBossJobCardQuery, parseBossJobCardResponse} from "./boss/bossApi";
import {AiJobDecision, normalizeAiJobDecision} from "./boss/jobDecision";
import {evaluateJobTitleRule} from "./boss/jobTitleRule";
import {ApplicationSnapshotPayload, saveApplicationSnapshotWithRetry} from "./boss/rejectionAnalysis";
import {
    customGreetingEnabled,
    GREETING_RETRY_INTERVAL_MS,
    greetingBlocksNewApplications,
    greetingRequiresReadyChannel,
    normalizeGreetingDeliveryMode,
} from "./greetingPolicy";
import {makeGreetingTaskKey, migrateAndDedupeGreetingTasks} from "./greetingIdentity";
import {findBossMountTarget} from "../runtime/routeHost";
import {isSalaryWithinConfiguredRange} from "./salaryPolicy";

let pushResultCounter: any;
let userStore: any;


export enum PlatformTypeEnum {
    Boss,
    // ZhiLian,//智联
    // 前职无忧
    LiePin,
    UnKnow,
}

export interface ElementP {
    el: Element,
    p?: string,
    /**
     * True when the preferred route-specific container has not rendered yet.
     * The root may be shown here temporarily, but runtime readiness must remain
     * in recovery until a real mount target is found.
     */
    provisional?: boolean
}


export interface Platform {
    name: string,
    urlList: string[],
    curUrl: string,

    getMountEle(): Promise<ElementP>;

    getRenderComponent(): any;

    startPush(): Promise<PushRunOutcome>;

    pausePush(): void;

    getPlatformType(): PlatformTypeEnum;
}


export abstract class AbsPlatform implements Platform {
    abstract name: string;
    abstract curUrl: string;
    abstract urlList: string[];
    protected logRecorder: LogRecorder = new LogRecorder('recorder');

    protected pushStatus: PushStatus = PushStatus.NOT_START
    protected _pushMock: boolean = false;


    set pushMock(value: boolean) {
        this._pushMock = value;
    }

    abstract getPlatformType(): PlatformTypeEnum;

    abstract getMountEle(): Promise<ElementP>;

    abstract getRenderComponent(): Promise<any>;

    async startPush() {
        const riskStop = getBossRiskStop()
        if (riskStop) {
            this.logRecorder.error(`BOSS风控熔断已生效，禁止投递：${riskStop.reason}`)
            this.pushStatus = PushStatus.PAUSE
            return {status: 'blocked', reason: riskStop.reason} as PushRunOutcome
        }
        this.logRecorder.info("开始投递")
        // 每次投递前清空单次成功计数器
        pushResultCounter.clearOnceSuccessCount()
        this.pushStatus = PushStatus.PUSHING;
        this.startPreHandler()
        do {
            // 获取jobDetail集合并过滤
            let jobList = this.getJobList();
            for (const jobDetail of jobList) {
                try {
                    await this.waitForDeliveryGate()
                    this.preMatchJob();
                    await this.matchJob(jobDetail);
                    this.pushPreHandler(jobDetail);
                    const pushResult = await this.push(jobDetail);
                    await this.pushAfterHandler(pushResult, jobDetail);
                    this.markJobTerminal(jobDetail)
                } catch (error) {
                    switch (true) {
                        case error instanceof AiDecisionUnknownExp:
                            this.logRecorder.warn(`工作【${error.jobTitle}】AI 决策不可验证，本次未投递且未标记为已处理：${error.message}`)
                            pushResultCounter.failIncr()
                            break

                        case error instanceof JobDetailUnavailableExp:
                            this.logRecorder.warn(`工作【${error.jobTitle}】岗位详情暂不可用（${error.code}），本次未标记为已处理：${error.message}`)
                            pushResultCounter.failIncr()
                            break

                        case error instanceof NotMatchException:
                            this.markJobTerminal(jobDetail)
                            if (this.logRecorder.getLogLevel() === LogLevel.Debug) {
                                this.logRecorder.info(`工作【${error.jobTitle}】被过滤 原因：${error.message} 当前值:${error.data}`)
                            } else {
                                this.logRecorder.info(`工作【${error.jobTitle}】被过滤 原因：${error.message}`)
                            }
                            pushResultCounter.notMatchIncr()
                            break;

                        case error instanceof PushReqException:
                            // 发起沟通是不可安全盲重试的副作用。请求结果不明时
                            // 当前运行不再重复处理该岗位，等待后续对账/人工确认。
                            this.markJobTerminal(jobDetail)
                            this.logRecorder.warn(`工作【${error.jobTitle}】投递失败 原因：${error.message}`)
                            pushResultCounter.failIncr()
                            break

                        case error instanceof FetchJobBossFailExp:
                            // 此异常发生在发起沟通后的招呼阶段，不能重新投递岗位。
                            this.markJobTerminal(jobDetail)
                            this.logRecorder.warn(`工作【${error.jobTitle}】发送自定义招呼语失败 原因：${error.message}`)
                            break

                        // 投递停止；手动停止.结束链路
                        case error instanceof PublishStopExp:
                            this.logRecorder.info("手动暂停投递 " + error.message)
                            return {status: 'stopped', reason: error.message} as PushRunOutcome;
                        // 投递限制；平台限制.结束链路
                        case error instanceof PublishLimitExp:
                            this.logRecorder.info("停止投递 " + error.message)
                            return {status: 'blocked', reason: error.message} as PushRunOutcome;

                        default:
                            logger.error("未捕获异常--->", error)
                            throw error
                    }
                }
            }
        } while (await this.next())
        this.logRecorder.info("结束投递")
        return {status: 'completed'} as PushRunOutcome
    }

    next = async () => {
        const nextPageInterval = Math.max(
            SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
            Number(userStore.user.preference.npi) || 0,
        )
        await Tools.sleep(nextPageInterval * 1000)
        const next = await this.acquireDataPre();
        if (!next) {
            this.logRecorder.info("没有更多可用职位或求职期望")
        }
        return next
    };

    pausePush(): void {
    }

    abstract hasNext(): boolean;

    abstract acquireDataPre(): Promise<boolean>;

    abstract startPreHandler(): void;
    abstract getJobList(): JobDetail[];

    abstract matchJob(jobDetail: JobDetail): Promise<boolean>;

    abstract pushPreHandler(jobDetail: JobDetail): JobDetail;

    preMatchJob(): void {
        // 投递前检查，避免无意义的匹配过滤
        if (this.pushStatus == PushStatus.PAUSE) {
            throw new PublishStopExp("手动暂停投递")
        }
    }

    async push(jobDetail: JobDetail): Promise<PushResult> {
        if (this.pushStatus == PushStatus.PAUSE) {
            throw new PublishStopExp("手动暂停投递")
        }

        // 检查投递限制
        let limitResult = this.isLimit(jobDetail);
        if (limitResult.limit) {
            throw new PublishLimitExp(limitResult.msg)
        }

        if (this._pushMock) {
            let jobTitle = this.getJobKey(jobDetail);
            logger.debug("mock投递 ", jobTitle)
            return {
                message: 'Success',
                code: 0
            }
        }
        return await this.doPush(jobDetail);
    }

    isLimit(jobDetail: JobDetail): { limit: boolean, msg: string } {
        return {
            limit: false,
            msg: this.getJobKey(jobDetail)
        }
    }

    abstract doPush(jobDetail: JobDetail): Promise<any>;

    abstract pushAfterHandler(pushResult: PushResult, jobDetail: JobDetail): Promise<any> ;

    abstract getJobKey(jobDetail: JobDetail): string;

    protected async waitForDeliveryGate(): Promise<void> {
        return
    }

    protected markJobTerminal(jobDetail: JobDetail): void {
        ;(jobDetail as any).processed = true
    }

    getFistJobDetail(): JobDetail {
        return this.getJobList()[0]
    }
}


type PendingGreeting = {
    key: string,
    jobTitle: string,
    brandName: string,
    toUid?: string,
    toName: string,
    content: string,
    createdAt: number,
    attempts: number,
    clientMid?: string,
    serverMid?: string,
    conversationKey: string,
    acknowledgedAt?: number,
    dispatchedAt?: number,
    manualReviewAt?: number,
    bossLookup?: {
        encryptBossId: string,
        securityId: string,
    },
}

export type PushRunOutcome = {
    status: 'completed' | 'stopped' | 'blocked',
    reason?: string,
}

class BossPlatform extends AbsPlatform {
    private static readonly AI_FILTER_CACHE_KEY = 'ai-job-filter-cache-v2';
    private static readonly AI_FILTER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    private static readonly AI_FILTER_CACHE_MAX_ENTRIES = 150;
    private static readonly GREETING_QUEUE_KEY = 'ai-job-pending-greetings-v1';
    private static readonly GREETING_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    curUrl: string;
    name = "Boss";
    urlList = ["/web/geek", "overseas"];
    lastHeight = 0;
    private processedJobKeys = new Set<string>();
    private visitedExpectationKeys = new Set<string>();
    private currentExpectationKey = "";
    private greetingSendingKeys = new Set<string>();
    private greetingQueueDrainRunning = false;
    private greetingRetryTimer: number | null = null;
    private greetingQueueListenerStarted = false;
    private greetingDomFallbackRunning = false;
    private receiptVerifierRunning = false;
    private lastJobSourceDiagnosticKey = "";
    private applicationSnapshotContexts = new Map<string, Omit<ApplicationSnapshotPayload, 'appliedAt'>>();

    private buildAiFilterCacheKey(parts: string[]): string {
        const raw = parts.join('\u0001')
        let hash = 2166136261
        for (let i = 0; i < raw.length; i++) {
            hash ^= raw.charCodeAt(i)
            hash = Math.imul(hash, 16777619)
        }
        return `${raw.length}:${(hash >>> 0).toString(16)}`
    }

    private readAiFilterCache(): Record<string, {expiresAt: number, result: AiJobDecision}> {
        try {
            const parsed = JSON.parse(localStorage.getItem(BossPlatform.AI_FILTER_CACHE_KEY) || '{}')
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {}
            }
            const now = Date.now()
            return Object.fromEntries(Object.entries(parsed).flatMap(([key, entry]: [string, any]) => {
                if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
                    return []
                }
                const decision = normalizeAiJobDecision(entry.result)
                return decision.cacheable ? [[key, {expiresAt: entry.expiresAt, result: decision}]] : []
            })) as Record<string, {expiresAt: number, result: AiJobDecision}>
        } catch (e) {
            logger.warn('读取JD评分缓存失败，已忽略损坏缓存', e)
            return {}
        }
    }

    private getCachedAiFilterResult(key: string): AiJobDecision | null {
        const cache = this.readAiFilterCache()
        return cache[key]?.result || null
    }

    private cacheAiFilterResult(key: string, result: any): void {
        const decision = normalizeAiJobDecision(result)
        if (!decision.cacheable) {
            return
        }
        const cache = this.readAiFilterCache()
        cache[key] = {
            expiresAt: Date.now() + BossPlatform.AI_FILTER_CACHE_TTL_MS,
            // 运行逻辑只依赖这三个字段，避免在浏览器里长期保存大段模型分析。
            result: {
                status: decision.status,
                filter: decision.filter,
                reason: decision.reason,
                ...(Number.isFinite(decision.score) ? {score: decision.score} : {}),
                cacheable: true,
            },
        }
        const entries = Object.entries(cache)
            .sort(([, left], [, right]) => right.expiresAt - left.expiresAt)
            .slice(0, BossPlatform.AI_FILTER_CACHE_MAX_ENTRIES)
        try {
            localStorage.setItem(BossPlatform.AI_FILTER_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
        } catch (e) {
            logger.warn('写入JD评分缓存失败，本次将继续使用实时评分', e)
        }
    }

    private readGreetingQueue(): PendingGreeting[] {
        try {
            const now = Date.now()
            // GM 存储可跨 BOSS 标签页共享。兼容读取旧版 localStorage，避免升级时丢失待补发任务。
            const gmRaw = GM_getValue(BossPlatform.GREETING_QUEUE_KEY, '') as string
            const localRaw = localStorage.getItem(BossPlatform.GREETING_QUEUE_KEY) || ''
            const queue = JSON.parse(gmRaw || localRaw || '[]')
            if (!Array.isArray(queue)) {
                return []
            }
            return migrateAndDedupeGreetingTasks(queue.map((item: PendingGreeting) => ({
                ...item,
                conversationKey: item?.conversationKey || makeConversationKey(
                    item?.bossLookup?.encryptBossId,
                    item?.bossLookup?.securityId,
                ),
            }))).filter((item: PendingGreeting) => item?.key && item?.toName && item?.conversationKey
                && (item?.toUid || (item?.bossLookup?.encryptBossId && item?.bossLookup?.securityId))
                && item?.content && now - Number(item.createdAt || 0) < BossPlatform.GREETING_QUEUE_MAX_AGE_MS)
                .slice(-100)
        } catch (error) {
            this.logRecorder.warn('读取自定义招呼语补发队列失败，已忽略损坏数据')
            return []
        }
    }

    private writeGreetingQueue(queue: PendingGreeting[]): void {
        const raw = JSON.stringify(queue.slice(-100))
        // 同时写 GM 与 localStorage：新版本跨标签页实时同步，旧版本仍可继续领取队列。
        GM_setValue(BossPlatform.GREETING_QUEUE_KEY, raw)
        localStorage.setItem(BossPlatform.GREETING_QUEUE_KEY, raw)
    }

    private enqueueGreeting(entry: PendingGreeting): void {
        const queue = this.readGreetingQueue().filter(item => item.key !== entry.key)
        queue.push(entry)
        this.writeGreetingQueue(queue)
        recordDeliveryAudit({
            key: entry.key,
            kind: 'greeting',
            status: 'queued',
            jobTitle: entry.jobTitle,
            content: entry.content,
            attempts: entry.attempts,
            bossId: entry.toUid,
            conversationKey: entry.conversationKey,
            clientMid: entry.clientMid,
            serverMid: entry.serverMid,
        })
    }

    /** Merge one delivery into the latest shared queue snapshot while its send lock is held. */
    private persistGreetingEntry(entry: PendingGreeting): void {
        const latest = this.readGreetingQueue().filter(item => item.key !== entry.key)
        latest.push(entry)
        this.writeGreetingQueue(latest)
    }

    private removeGreetingFromQueue(key: string): void {
        this.writeGreetingQueue(this.readGreetingQueue().filter(item => item.key !== key))
    }

    private markGreetingAsFailed(entry: PendingGreeting, lastError?: unknown): void {
        this.removeGreetingFromQueue(entry.key)
        recordDeliveryAudit({
            key: entry.key, kind: 'greeting', status: 'failed', jobTitle: entry.jobTitle,
            content: entry.content, attempts: entry.attempts, lastError, bossId: entry.toUid,
            conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
        })
        this.logRecorder.error(`工作【${entry.jobTitle}】招呼语连续发送失败，已结束该任务并继续处理后续消息`)
    }

    private persistGreetingFailure(entry: PendingGreeting, lastError?: unknown): void {
        entry.attempts += 1
        if (isExhaustedDelivery(entry)) {
            this.markGreetingAsFailed(entry, lastError)
            return
        }
        this.enqueueGreeting(entry)
    }

    /** Migrates terminal entries left by older builds so they cannot remain at the queue head. */
    private pruneExhaustedGreetingQueue(queue = this.readGreetingQueue()): PendingGreeting[] {
        const exhausted = findExhaustedDeliveries(queue)
        if (exhausted.length === 0) return queue

        const retained = queue.filter(entry => !isExhaustedDelivery(entry))
        this.writeGreetingQueue(retained)
        for (const entry of exhausted) {
            recordDeliveryAudit({
                key: entry.key, kind: 'greeting', status: 'failed', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts,
                lastError: 'retry limit reached', bossId: entry.toUid,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
        }
        return retained
    }

    private async deliverPendingGreeting(entry: PendingGreeting, waitForChannel: boolean): Promise<boolean> {
        const lockScope = 'greeting'
        const lockIdentity = deliveryScopeKey(entry)
        const execution = await runWithOptionalDeliveryLock(
            (globalThis.navigator as any)?.locks,
            lockScope,
            lockIdentity,
            async () => {
                // The queue is shared by every BOSS tab. Never trust the snapshot
                // selected before the cross-tab lock was acquired.
                const current = this.readGreetingQueue().find(item => item.key === entry.key)
                if (!current) return false
                Object.assign(entry, current)
                return await this.deliverPendingGreetingLocked(entry, waitForChannel)
            },
        )
        return execution.acquired ? !!execution.value : false
    }

    private async deliverPendingGreetingLocked(entry: PendingGreeting, waitForChannel: boolean): Promise<boolean> {
        if (getBossRiskStop()) return false
        if (this.greetingSendingKeys.has(entry.key)) {
            return false
        }
        if (Tools.isHardBlockedCompany(entry.brandName, entry.jobTitle)) {
            this.removeGreetingFromQueue(entry.key)
            recordDeliveryAudit({
                key: entry.key, kind: 'greeting', status: 'blocked', jobTitle: entry.jobTitle,
                content: entry.content, bossId: entry.toUid, conversationKey: entry.conversationKey,
                clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            this.logRecorder.warn(`工作【${entry.jobTitle}】命中潮一硬屏蔽，已从招呼语补发队列移除`)
            return false
        }
        if ((isDispatchUncertain(entry) || isManualReviewDelivery(entry)) && entry.clientMid) {
            const lateAck = Tools.window.AIJobHelperChatBridge?.getAcknowledgement?.(entry.clientMid)
            const lateServerMid = String(lateAck?.serverMid || '')
            if (!lateServerMid) {
                if (shouldMoveUncertainToManualReview(entry)) {
                    entry.manualReviewAt = Date.now()
                    this.persistGreetingEntry(entry)
                    recordDeliveryAudit({
                        key: entry.key, kind: 'greeting', status: 'sending', jobTitle: entry.jobTitle,
                        content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
                        conversationKey: entry.conversationKey, clientMid: entry.clientMid,
                        lastError: 'BOSS ACK missing; manual review required',
                    })
                    this.logRecorder.warn(`工作【${entry.jobTitle}】招呼语ACK长时间未返回，结果未知；已永久禁止自动重发并转人工核对`)
                }
                return false
            }
            entry.clientMid = String(lateAck?.clientMid || entry.clientMid)
            entry.serverMid = lateServerMid
            entry.acknowledgedAt = Date.now()
            delete entry.manualReviewAt
            this.persistGreetingEntry(entry)
            recordDeliveryAudit({
                key: entry.key, kind: 'greeting', status: 'acknowledged', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            this.logRecorder.warn(`工作【${entry.jobTitle}】已关联迟到的BOSS ACK，继续等待页面送达/已读回执`)
            return true
        }
        const existingAudit = readDeliveryAudit().find(item => item.kind === 'greeting' && item.key === entry.key)
        const verifiedExistingReceipt = existingAudit?.status === 'receipt'
            && !!entry.toUid
            && existingAudit.bossId === String(entry.toUid)
            && existingAudit.conversationKey === entry.conversationKey
            && !!existingAudit.clientMid && !!existingAudit.serverMid
        const deliveryIdentity = entry.toUid && entry.conversationKey && entry.clientMid && entry.serverMid
            ? {
                bossId: entry.toUid,
                conversationKey: entry.conversationKey,
                clientMid: entry.clientMid,
                serverMid: entry.serverMid,
            }
            : null
        if (verifiedExistingReceipt
            || (deliveryIdentity && hasBossDeliveryReceipt(entry.content, deliveryIdentity))) {
            this.removeGreetingFromQueue(entry.key)
            recordDeliveryAudit({
                key: entry.key, kind: 'greeting', status: 'receipt', jobTitle: entry.jobTitle,
                content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
                conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
            })
            return true
        }
        // serverMid 表示 BOSS 已接收该 clientMid；后续只等待可见送达/已读，绝不重复发送。
        if (hasServerAcknowledgement(entry)) {
            return false
        }
        if (isExhaustedDelivery(entry)) {
            this.markGreetingAsFailed(entry, 'retry limit reached')
            return false
        }
        this.greetingSendingKeys.add(entry.key)
        try {
            // 投递成功后页面可能马上刷新或切走。队列会先保存 Boss 查询参数，
            // 后续任意 BOSS 页面恢复时再补齐 uid，避免只留下“已沟通”而没有招呼语。
            if (!entry.toUid) {
                if (!entry.bossLookup?.encryptBossId || !entry.bossLookup?.securityId) {
                    this.logRecorder.warn(`工作【${entry.jobTitle}】缺少Boss定位信息，招呼语继续保留待补发`)
                    return false
                }
                try {
                    const bossData = await this.requestBossData({
                        encryptBossId: entry.bossLookup.encryptBossId,
                        securityId: entry.bossLookup.securityId,
                    } as BossJobDetail)
                    entry.toUid = bossData.data.bossId.toString()
                    entry.toName = entry.bossLookup.encryptBossId
                    this.enqueueGreeting(entry)
                } catch (error: any) {
                    this.persistGreetingFailure(entry, error)
                    this.logRecorder.warn(`工作【${entry.jobTitle}】获取Boss信息失败，招呼语已保留待补发`, error?.message || error)
                    return false
                }
            }
            // GeekChatCore 的 SharedWorker 尚未就绪时只保留队列，由通道就绪事件
            // 或有界的定时器继续处理，避免在一轮内密集重试。
            if (!Tools.window.AIJobHelperChatBridge?.isReady?.() && waitForChannel) {
                await Promise.resolve(Tools.window.AIJobHelperChatBridge?.ensureReady?.(8_000))
            }
            if (!Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                return false
            }
            const message = new Message({
                form_uid: Tools.window._PAGE.uid.toString(),
                to_uid: entry.toUid!,
                to_name: entry.toName,
                content: entry.content,
                image: undefined,
                clientMid: entry.clientMid,
            })
            if (!entry.clientMid) {
                entry.clientMid = String(message.msgObj.cmid)
                // Persist before the first network write so every later retry uses the
                // same id and BOSS can safely de-duplicate an ACK-loss retry.
                this.enqueueGreeting(entry)
            }
            // 每轮只做一次有副作用发送；失败由一分钟一次的队列做有界重试。
            const requestedClientMid = String(entry.clientMid || '')
            const sent = await message.send(1, 1_000)
            const actualClientMid = String(message.msgObj.cmid || requestedClientMid)
            entry.clientMid = actualClientMid
            if (sent) {
                entry.serverMid = String((message.msgObj as any).__serverMid || '')
                if (!entry.serverMid) {
                    this.persistGreetingFailure(entry, 'BOSS ACK missing serverMid')
                    return false
                }
                entry.acknowledgedAt = Date.now()
                delete entry.manualReviewAt
                this.persistGreetingEntry(entry)
                recordDeliveryAudit({
                    key: entry.key, kind: 'greeting', status: 'acknowledged', jobTitle: entry.jobTitle,
                    content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
                    conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
                })
                this.logRecorder.warn(`工作【${entry.jobTitle}】自定义招呼语已获服务器确认，等待页面送达/已读回执`)
                return true
            }
            const dispatchedAt = Number((message.msgObj as any).__dispatchedAt || 0)
            if (dispatchedAt > 0) {
                // Dispatch acceptance without a server ACK is an unknown outcome,
                // never evidence of failure. Persist it and wait for a late ACK;
                // issuing another network write could duplicate a real greeting.
                entry.dispatchedAt = dispatchedAt
                this.persistGreetingEntry(entry)
                recordDeliveryAudit({
                    key: entry.key, kind: 'greeting', status: 'sending', jobTitle: entry.jobTitle,
                    content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
                    conversationKey: entry.conversationKey, clientMid: entry.clientMid,
                    lastError: 'SDK dispatch accepted; awaiting BOSS ACK',
                })
                this.logRecorder.warn(`工作【${entry.jobTitle}】招呼语已交给BOSS SDK，ACK暂未返回；已暂停重发以防重复消息`)
                return false
            }
            this.persistGreetingFailure(entry, 'chat bridge did not acknowledge the message')
            return false
        } finally {
            this.greetingSendingKeys.delete(entry.key)
        }
    }

    /**
     * 聊天页兜底：BOSS 有时会在首次沟通后立即销毁职位标签页，导致该标签页
     * 尚未来得及把跨标签补发队列写完整。聊天列表中“您正在与Boss…沟通”是
     * 官方页面给出的确定状态，表示会话已建立但一条消息都没有发送。
     *
     * 这里只补这一种状态；草稿、已发送、HR 已回复以及用户正在输入时都不碰，
     * 防止抢占用户操作或重复发消息。
     */
    private async deliverUngreetedConversationFromDom(): Promise<void> {
        const greeting = userStore?.user?.preference?.cg?.trim() || ''
        const greetingMode = normalizeGreetingDeliveryMode(
            userStore?.user?.preference?.greetingDeliveryMode,
            !!userStore?.user?.preference?.cgE,
            greeting,
        )
        if (this.greetingDomFallbackRunning
            || !location.pathname.includes('/web/geek/chat')
            || !customGreetingEnabled(greetingMode)
            || !greeting) {
            return
        }

        const activeEditor = document.querySelector('[contenteditable="true"]') as HTMLElement | null
        const activeDraft = activeEditor?.innerText?.trim() || ''
        // 非插件招呼语的草稿视为用户正在编辑，绝不抢占。插件自己留下的完整招呼语
        // 则继续尝试发送，避免发送按钮短暂不可用后永久卡成草稿。
        if (activeDraft && activeDraft !== greeting) {
            return
        }

        if (activeEditor && activeDraft === greeting) {
            const selected = conversationIdentityFromElement(document.querySelector('.friend-content.selected'))
            if (!selected) {
                this.logRecorder.warn('检测到未发送的自定义招呼语草稿，但无法精确识别当前联系人，已禁止盲发')
                return
            }
            const selectedTaskKey = makeGreetingTaskKey(selected.encryptBossId)
            const existing = this.readGreetingQueue().find(item => item.key === selectedTaskKey)
            if (existing) {
                this.recoverGreetingAfterConfirmedUngreeted(existing)
                const confirmed = await this.deliverPendingGreeting(existing, true)
                if (confirmed || existing.serverMid) {
                    activeEditor.innerHTML = ''
                    activeEditor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'}))
                }
                return
            }
            const entry: PendingGreeting = {
                key: selectedTaskKey,
                jobTitle: (document.querySelector('.top-info-content') as HTMLElement | null)?.innerText?.trim() || '当前会话',
                brandName: selected.brandName
                    || (document.querySelector('.top-info-content') as HTMLElement | null)?.innerText?.trim() || '',
                toUid: selected.bossId,
                toName: selected.encryptBossId,
                content: greeting,
                createdAt: Date.now(),
                attempts: 0,
                clientMid: Message.createClientMid(),
                conversationKey: selected.conversationKey,
                bossLookup: {encryptBossId: selected.encryptBossId, securityId: selected.securityId},
            }
            this.greetingDomFallbackRunning = true
            try {
                this.enqueueGreeting(entry)
                if (await this.deliverPendingGreeting(entry, true)) {
                    // This is the plugin's exact full draft. Clear it only after BOSS has
                    // acknowledged the same clientMid, preventing a later manual duplicate.
                    activeEditor.innerHTML = ''
                    activeEditor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward'}))
                }
            } finally {
                this.greetingDomFallbackRunning = false
            }
            return
        }

        const row = Array.from(document.querySelectorAll('li')).find(item =>
            item.textContent?.includes('您正在与Boss')
            && !item.textContent?.includes('[草稿]')
        ) as HTMLElement | undefined
        if (!row) {
            return
        }

        const rowText = row.innerText || row.textContent || ''
        if (Tools.isHardBlockedCompany(rowText, rowText)) {
            this.logRecorder.warn(`会话【${rowText.split('\n').slice(0, 3).join(' ')}】命中潮一硬屏蔽，禁止兜底发送招呼语`)
            return
        }

        const identity = conversationIdentityFromElement(row)
        if (!identity) {
            this.logRecorder.warn(`会话【${rowText.split('\n').slice(0, 3).join(' ')}】无法精确绑定Boss身份，已禁止盲发招呼语`)
            return
        }
        const identityTaskKey = makeGreetingTaskKey(identity.encryptBossId)
        const existing = this.readGreetingQueue().find(item => item.key === identityTaskKey)
        if (existing) {
            this.recoverGreetingAfterConfirmedUngreeted(existing)
            await this.deliverPendingGreeting(existing, true)
            return
        }
        const entry: PendingGreeting = {
            key: identityTaskKey,
            jobTitle: rowText.split('\n').slice(0, 3).join(' '),
            brandName: identity.brandName || rowText,
            toUid: identity.bossId,
            toName: identity.encryptBossId,
            content: greeting,
            createdAt: Date.now(),
            attempts: 0,
            clientMid: Message.createClientMid(),
            conversationKey: identity.conversationKey,
            bossLookup: {encryptBossId: identity.encryptBossId, securityId: identity.securityId},
        }
        this.greetingDomFallbackRunning = true
        try {
            this.enqueueGreeting(entry)
            await this.deliverPendingGreeting(entry, true)
        } catch (error: any) {
            this.logRecorder.warn('聊天页兜底发送自定义招呼语失败，将自动重试', error?.message || error)
        } finally {
            this.greetingDomFallbackRunning = false
        }
    }

    private recoverGreetingAfterConfirmedUngreeted(entry: PendingGreeting): void {
        if (!canRetryAfterConfirmedUngreeted(entry)) return

        delete entry.dispatchedAt
        delete entry.manualReviewAt
        delete entry.acknowledgedAt
        delete entry.serverMid
        entry.attempts = 0
        this.enqueueGreeting(entry)
        recordDeliveryAudit({
            key: entry.key, kind: 'greeting', status: 'queued', jobTitle: entry.jobTitle,
            content: entry.content, attempts: entry.attempts, bossId: entry.toUid,
            conversationKey: entry.conversationKey, clientMid: entry.clientMid,
            lastError: 'Exact BOSS conversation confirmed no greeting; retry unlocked',
        })
        this.logRecorder.warn(`工作【${entry.jobTitle}】聊天页已确认未发送招呼，现已恢复自动补发`)
    }

    private rowMatchesAuditTitle(rowText: string, jobTitle: string): boolean {
        const normalize = (value: string) => value.normalize('NFKC').replace(/[\s·|｜_—–-]+/g, '').toLowerCase()
        const normalizedRow = normalize(rowText)
        const normalizedTitle = normalize(jobTitle)
        if (!normalizedRow || !normalizedTitle) return false
        if (normalizedRow.includes(normalizedTitle) || normalizedTitle.includes(normalizedRow)) return true
        const parts = jobTitle.split('-').map(part => part.trim()).filter(Boolean)
        const brand = normalize(parts[0] || '')
        const recruiter = normalize(parts.at(-1) || '')
        return recruiter.length >= 2 && normalizedRow.includes(recruiter)
            && brand.length >= 2 && normalizedRow.includes(brand.length >= 6 ? brand.slice(0, 4) : brand)
    }

    private async verifyOnePendingReceiptFromDom(): Promise<void> {
        if (this.receiptVerifierRunning || !location.pathname.includes('/web/geek/chat')) return
        reconcileDeliveryAuditFromDom()
        const pending = readDeliveryAudit().filter(item => item.status === 'acknowledged')
        if (pending.length === 0) return

        this.receiptVerifierRunning = true
        try {
            for (const entry of pending) {
                if (!entry.bossId || !entry.conversationKey || !entry.clientMid || !entry.serverMid
                    || !hasBossDeliveryReceipt(entry.content, {
                        bossId: entry.bossId,
                        conversationKey: entry.conversationKey,
                        clientMid: entry.clientMid,
                        serverMid: entry.serverMid,
                    })) continue
                recordDeliveryAudit({
                    key: entry.key, kind: entry.kind, status: 'receipt', jobTitle: entry.jobTitle,
                    content: entry.content, attempts: entry.attempts, bossId: entry.bossId,
                    conversationKey: entry.conversationKey, clientMid: entry.clientMid, serverMid: entry.serverMid,
                })
                if (entry.kind === 'greeting') this.removeGreetingFromQueue(entry.key)
                return
            }
            // 不再为了核验回执自动点击其他联系人，避免聊天页乱切和重复详情请求。
            // 用户自然打开某会话后，上方精确身份检查会完成回执闭环。
        } finally {
            this.receiptVerifierRunning = false
        }
    }

    private async drainGreetingQueue(): Promise<void> {
        if (getBossRiskStop() || this.greetingQueueDrainRunning) return
        const greetingMode = normalizeGreetingDeliveryMode(
            userStore?.user?.preference?.greetingDeliveryMode,
            !!userStore?.user?.preference?.cgE,
            userStore?.user?.preference?.cg,
        )
        if (!customGreetingEnabled(greetingMode)) return
        this.greetingQueueDrainRunning = true
        try {
            const queue = this.pruneExhaustedGreetingQueue()
            for (const uncertain of queue.filter(entry =>
                isDispatchUncertain(entry) || isManualReviewDelivery(entry))) {
                await this.deliverPendingGreeting(uncertain, false)
            }
            // An unknown dispatch blocks only its own conversation. The selector
            // below skips that scope while allowing unrelated greetings to proceed.
            const next = findNextRetryableOutsideUnknownScopes(
                queue,
                this.greetingSendingKeys,
            )
            if (next && Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                await this.deliverPendingGreeting(next, false)
            }
            await this.deliverUngreetedConversationFromDom()
            await this.verifyOnePendingReceiptFromDom()
        } finally {
            this.greetingQueueDrainRunning = false
        }
    }

    private startGreetingRetryWorker(): void {
        if (this.greetingRetryTimer !== null) {
            return
        }
        this.greetingRetryTimer = window.setInterval(() => {
            void this.drainGreetingQueue().catch(error => {
                this.logRecorder.error('招呼语后台补发任务失败', error)
            })
        }, GREETING_RETRY_INTERVAL_MS)

        if (!this.greetingQueueListenerStarted) {
            this.greetingQueueListenerStarted = true
            Tools.window.addEventListener(CHAT_BRIDGE_READY_EVENT, () => {
                void this.drainGreetingQueue().catch(error => {
                    this.logRecorder.error('消息通道就绪后的招呼语补发失败', error)
                })
            })
            GM_addValueChangeListener(BossPlatform.GREETING_QUEUE_KEY, async (_name, _oldValue, _newValue, remote) => {
                if (!remote || !Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                    return
                }
                try {
                    await this.drainGreetingQueue()
                } catch (error) {
                    this.logRecorder.error('跨标签页招呼语补发失败', error)
                }
            })
            if (Tools.window.AIJobHelperChatBridge?.isReady?.()) {
                void this.drainGreetingQueue().catch(error => {
                    this.logRecorder.error('启动时招呼语补发失败', error)
                })
            }
        }
    }


    constructor(curUrl: string) {
        super();
        this.curUrl = curUrl;
        this.startGreetingRetryWorker();
    }

    getPlatformType(): PlatformTypeEnum {
        return PlatformTypeEnum.Boss;
    }


    getMountEle(): Promise<ElementP> {
        return new Promise<ElementP>((resolve) => {
            let count: number = 0;
            const maxAttempts = 40;
            let interval = setInterval(() => {
                const preferredTarget = findBossMountTarget(document, this.curUrl)
                if (preferredTarget !== null) {
                    clearInterval(interval);
                    return resolve(preferredTarget)
                }
                if (count >= maxAttempts) {
                    clearInterval(interval);
                    // BOSS 的职位列表在慢网络下会晚于 DOMContentLoaded 渲染。
                    // 即便目标容器仍未出现，也必须 resolve，避免助手永久卡在初始化阶段。
                    const fallback = findBossMountTarget(document, this.curUrl, true)
                    logger.warn(PlatformTypeEnum.Boss, "未找到首选挂载元素，使用页面容器兜底")
                    return resolve(fallback ?? {el: document.body, p: "end", provisional: true})
                }
                count++;
            }, 250);
        })
    }

    protected async waitForDeliveryGate(): Promise<void> {
        const riskStop = getBossRiskStop()
        if (riskStop) throw new PublishLimitExp(`BOSS风控熔断：${riskStop.reason}`)
        let lastLogAt = 0
        const gateStartedAt = Date.now()
        while (this.pushStatus === PushStatus.PUSHING) {
            const now = Date.now()
            const greetingQueue = this.pruneExhaustedGreetingQueue()
            let aiReplyQueue: RetryQueueEntry[] = []
            try {
                const raw = GM_getValue('ai-job-pending-ai-replies-v1', '') as string
                const queue = JSON.parse(raw || localStorage.getItem('ai-job-pending-ai-replies-v1') || '[]')
                aiReplyQueue = Array.isArray(queue) ? queue.filter(item => item?.key
                    && now - Number(item.createdAt || 0) < BossPlatform.GREETING_QUEUE_MAX_AGE_MS) : []
            } catch (_) {
                aiReplyQueue = []
            }
            // A server ACK is enough to let the next application progress. The acknowledged
            // entry remains persisted and the receipt verifier closes it in the background.
            const greetingMode = normalizeGreetingDeliveryMode(
                userStore?.user?.preference?.greetingDeliveryMode,
                !!userStore?.user?.preference?.cgE,
                userStore?.user?.preference?.cg,
            )
            // AI replies and background greetings are independent workers. Only the
            // explicitly selected strict greeting mode may pause new applications.
            const pending = countDeliveryGateBlockers(
                greetingBlocksNewApplications(greetingMode) ? greetingQueue : [],
                aiReplyQueue,
                false,
            )
            if (pending === 0) return
            if (hasDeliveryGateTimedOut(gateStartedAt, now)) {
                throw new PublishLimitExp(`消息发送通道在两分钟内未恢复，仍有 ${pending} 条消息待确认；已安全停止本轮投递`)
            }
            if (now - lastLogAt >= 15_000) {
                lastLogAt = now
                this.logRecorder.warn(`发送闭环闸门：仍有 ${pending} 条招呼语或AI回复未取得BOSS服务器确认，已暂停新增沟通`)
            }
            await Tools.sleep(2_000)
        }
        throw new PublishStopExp('发送闭环尚未完成')
    }


    async getRenderComponent(): Promise<any> {
        if (this.curUrl.includes("www.zhipin.com/web/geek/chat")) {
            let promise = import('../components/ui/BossMessage.vue');
            return promise.then(item => item.default)
        }
        if (this.curUrl.includes("www.zhipin.com/web/geek/job") || this.curUrl.includes("overseas")) {
            let promise = import('../components/ui/BossJobList.vue');
            return promise.then(item => item.default)
        }

    }

    startPreHandler(): void {
        this.lastHeight = 0;
        this.processedJobKeys.clear();
        this.visitedExpectationKeys.clear();
        this.currentExpectationKey = this.getExpectationEntries()[0]?.key || "";
    }

    getJobList(): BossJobDetail[] {
        const collection = collectBossJobs(document, this.curUrl)
        const stats = collection.diagnostics
            .filter(item => item.inspected > 0)
            .map(item => `${item.source}:${item.accepted}/${item.inspected}`)
            .join(',')
        if (collection.jobs.length === 0) {
            const diagnosticKey = `${this.curUrl}|${stats}`
            if (diagnosticKey !== this.lastJobSourceDiagnosticKey) {
                this.lastJobSourceDiagnosticKey = diagnosticKey
                this.logRecorder.warn(`未读取到可投递岗位；数据源诊断：${stats || '页面尚未出现岗位卡片'}`)
            }
            return []
        }
        this.lastJobSourceDiagnosticKey = ""
        const requireUncontacted = this.curUrl.includes("job-recommend") || this.curUrl.includes("overseas")
        const jobList = collection.jobs.filter(job =>
            !job.processed
            && !this.processedJobKeys.has(this.getJobIdentity(job))
            && (!requireUncontacted || !job.contact)
        )
        if (jobList.length === 0) this.logRecorder.info("当前可识别岗位均已处理或已经沟通过")
        return this.sortJobsByPreference(jobList)
    }

    protected markJobTerminal(jobDetail: JobDetail): void {
        super.markJobTerminal(jobDetail)
        this.processedJobKeys.add(this.getJobIdentity(jobDetail as BossJobDetail))
    }

    private getJobIdentity(jobDetail: BossJobDetail): string {
        return jobDetail.encryptJobId || [
            jobDetail.jobName,
            jobDetail.brandName,
            jobDetail.cityName,
            jobDetail.areaDistrict,
            jobDetail.businessDistrict,
        ].filter(Boolean).join("|");
    }

    private sortJobsByPreference(jobList: BossJobDetail[]): BossJobDetail[] {
        const preference = userStore?.user?.preference
        if (!preference) {
            return jobList
        }
        return [...jobList].sort((left, right) => this.preferenceScore(right) - this.preferenceScore(left))
    }

    private preferenceScore(jobDetail: BossJobDetail): number {
        const preference = userStore.user.preference
        const text = this.buildBenefitText(jobDetail)
        let score = 0
        const jobTitleMatchMode = preference.jobTitleMatchMode || (preference.jniE ? 'required' : 'off')
        const titleDecision = evaluateJobTitleRule({
            jobName: jobDetail.jobName,
            includeKeywords: preference.jni,
            excludeKeywords: preference.jneE ? preference.jne : [],
            mode: jobTitleMatchMode,
        })
        if (jobTitleMatchMode !== 'off' && titleDecision.status === 'PASS') {
            // 目标技术方向优先于通勤与单项福利；required 模式稍后仍会执行硬门槛。
            score += 10
        }
        if (preference.commuteMode !== 'off' && this.matchesCommuteLocation(jobDetail)) {
            // 通勤距离比单项福利优先级更高。
            score += 3
        }
        if (preference.weekendMode !== 'off' && this.hasWeekendBenefit(text)) {
            score += 1
        }
        if (preference.insuranceMode !== 'off' && this.hasInsuranceBenefit(text)) {
            score += 1
        }
        return score
    }

    private matchesCommuteLocation(jobDetail: BossJobDetail, jobDetailExt?: any): boolean {
        const keywords = (userStore.user.preference.commuteLocations || [])
            .map((item: string) => item.trim().toLowerCase())
            .filter(Boolean)
        if (keywords.length === 0) {
            return false
        }
        const locationText = [
            jobDetail.cityName,
            jobDetail.areaDistrict,
            jobDetail.businessDistrict,
            jobDetailExt?.address,
            jobDetailExt?.postDescription,
        ].filter(Boolean).join(' ').toLowerCase()
        return keywords.some((keyword: string) => locationText.includes(keyword))
    }

    private buildBenefitText(jobDetail: BossJobDetail, jobDetailExt?: any): string {
        return [
            jobDetail.daysPerWeekDesc,
            ...(jobDetail.jobLabels || []),
            ...(jobDetail.welfareList || []),
            jobDetailExt?.postDescription,
        ].filter(Boolean).join(' ')
    }

    private hasWeekendBenefit(text: string): boolean {
        const negativeOnly = /(大小周|单双休|单休)/.test(text)
        const strongPositive = /(周末双休|固定双休|标准双休|周休(?:二|2)日|做五休二|五天工作制|周一至周五)/.test(text)
        if (negativeOnly && !strongPositive) {
            return false
        }
        return strongPositive || /双休/.test(text)
    }

    private hasInsuranceBenefit(text: string): boolean {
        if (/(无五险一金|没有五险一金|不提供五险一金)/.test(text)) {
            return false
        }
        return /(五险一金|六险一金|七险一金|社保.{0,8}公积金|公积金.{0,8}社保)/.test(text)
    }

    /**
     * 用户学历事实为全日制本科。技能、年限、专业和普通本科学校差异都只能给建议；
     * 只有 JD 明确把硕士/研究生/博士或 985/211 作为硬门槛时才跳过。
     * 该规则在浏览器端确定性执行，不能依赖异步 AI 评分是否及时返回。
     */
    private detectMandatoryAcademicMismatch(jobDetail: BossJobDetail, postDescription: string): string | null {
        const degree = String(jobDetail.jobDegree || '').replace(/\s+/g, '')
        if (/(硕士|研究生|博士)/.test(degree)) {
            return 'JD明确要求硕士/研究生及以上学历；当前学历事实为全日制本科'
        }

        const description = String(postDescription || '')
        for (const rawLine of description.split(/[\n。；;]/)) {
            const line = rawLine.replace(/\s+/g, '')
            if (!line || /(优先|加分|不限|不要求)/.test(line)) {
                continue
            }
            const mandatoryWord = /(必须|要求|仅限|第一学历|及以上|以上学历)/.test(line)
            if (/(硕士|研究生|博士)/.test(line) && mandatoryWord) {
                return 'JD明确要求硕士/研究生及以上学历；当前学历事实为全日制本科'
            }
            const eliteSchool = /(985|211)/.test(line)
            if (eliteSchool && (mandatoryWord || /(985|211).*(本科|院校|高校|毕业)/.test(line))) {
                return 'JD明确把985/211院校背景作为硬性要求；当前简历未声明该背景'
            }
        }
        return null
    }

    hasNext(): boolean {
        logger.debug("hasNext")
        if (this.curUrl.includes("jobs")) {
            const list = document.querySelector(".job-list-container")
            return this.getJobList().length > 0
                || (list instanceof HTMLElement && list.scrollTop + list.clientHeight < list.scrollHeight - 2)
                || this.getExpectationEntries().some(item => !this.visitedExpectationKeys.has(item.key))
        }
        if (this.curUrl.includes("overseas")) {
            return this.lastHeight != document.querySelector(".job-list")?.scrollHeight
        }
        if (this.curUrl.includes("job-recommend")) {
            return !!document.querySelector("#footer");
        }
        let nextPageBtn = document.querySelector(".ui-icon-arrow-right") as any;
        if (nextPageBtn === null) {
            return false;
        }
        return nextPageBtn.parentElement.className !== "disabled";
    }

    async acquireDataPre(): Promise<boolean> {
        if (getBossRiskStop()) return false
        // 在等待下一页时点击了停止，不继续获取下一页数据
        if (this.pushStatus == PushStatus.PAUSE) {
            return false;
        }
        if (this.curUrl.includes("jobs")) {
            if (await this.loadMoreJobs()) {
                this.logRecorder.info("自动翻页成功，继续处理新职位")
                return true;
            }
            return await this.switchToNextExpectation();
        } else if (this.curUrl.includes("job-recommend")) {
            try {
                await simulateScrollToEnd()
                await Tools.sleep(1500)
                return this.getJobList().length > 0
            } catch (e) {
                this.logRecorder.warn("获取下一页失败", e)
                return false
            }
        }else if (this.curUrl.includes("overseas")) {
            this.lastHeight = document.querySelector(".job-list")?.scrollHeight as number
            try {
                await simulateScrollToEnd()
                await Tools.sleep(1500)
                return this.getJobList().length > 0
            } catch (e) {
                this.logRecorder.warn("获取下一页失败", e)
                return false
            }
        }
        // 点击下一页
        const nextButton = document.querySelector<any>(".ui-icon-arrow-right")
        if (!nextButton || nextButton.parentElement?.classList.contains("disabled")) {
            return false
        }
        nextButton.click();
        await Tools.sleep(1500)
        return true
    }

    private getVisibleJobIdentities(): Set<string> {
        const identities = collectBossJobs(document, this.curUrl).jobs
            .map(job => this.getJobIdentity(job))
            .filter(Boolean)
        return new Set(identities)
    }

    private getExpectationEntries(): Array<{key: string, element: HTMLElement}> {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(
            ".expect-list .expect-item:not(.add-expect-btn), .expect-and-search .expect-item:not(.add-expect-btn)"
        ))
        const unique = new Map<string, HTMLElement>()
        elements.forEach(element => {
            const key = (element.querySelector(".text-content")?.textContent || element.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
            if (key && !unique.has(key)) {
                unique.set(key, element)
            }
        })
        return Array.from(unique, ([key, element]) => ({key, element}))
    }

    private async loadMoreJobs(): Promise<boolean> {
        const beforeIds = this.getVisibleJobIdentities()
        const list = document.querySelector<HTMLElement>(".job-list-container")
            || document.querySelector<HTMLElement>(".job-list")
        this.lastHeight = list?.scrollHeight || document.documentElement.scrollHeight

        try {
            if (list) {
                scrollElementToBottom(list)
                list.dispatchEvent(new Event("scroll", {bubbles: true}))
            }
            await simulateScrollToEnd()
        } catch (e) {
            this.logRecorder.warn("自动滚动失败", e)
            return false
        }

        // BOSS 为异步/虚拟列表；等待真实的新职位出现，避免固定等待导致提前结束。
        for (let attempt = 0; attempt < 20; attempt++) {
            if (this.pushStatus == PushStatus.PAUSE) {
                return false
            }
            await Tools.sleep(500)
            const afterIds = this.getVisibleJobIdentities()
            if (Array.from(afterIds).some(id => !beforeIds.has(id) && !this.processedJobKeys.has(id))) {
                return true
            }
            const height = list?.scrollHeight || document.documentElement.scrollHeight
            if (height > this.lastHeight && this.getJobList().length > 0) {
                return true
            }
        }
        return false
    }

    private async switchToNextExpectation(): Promise<boolean> {
        const entries = this.getExpectationEntries()
        if (entries.length <= 1) {
            this.logRecorder.info("当前求职期望已无更多可用职位")
            return false
        }

        if (!this.currentExpectationKey) {
            this.currentExpectationKey = entries[0].key
        }
        this.visitedExpectationKeys.add(this.currentExpectationKey)

        const currentIndex = Math.max(0, entries.findIndex(item => item.key === this.currentExpectationKey))
        const ordered = [...entries.slice(currentIndex + 1), ...entries.slice(0, currentIndex + 1)]
        for (const entry of ordered) {
            if (this.visitedExpectationKeys.has(entry.key)) {
                continue
            }
            if (this.pushStatus == PushStatus.PAUSE) {
                return false
            }

            const beforeIds = this.getVisibleJobIdentities()
            const liveEntry = this.getExpectationEntries().find(item => item.key === entry.key)
            if (!liveEntry) {
                this.visitedExpectationKeys.add(entry.key)
                continue
            }
            // BOSS occasionally reuses expect-item styles on navigation links. Never let
            // automatic expectation switching activate a link that can leave the job page.
            const owningLink = liveEntry.element.closest('a')
            const linkHref = owningLink?.getAttribute('href')?.trim() || ''
            const safeHref = !owningLink
                || !linkHref
                || linkHref === 'javascript:;'
                || linkHref === 'javascript:void(0)'
                || linkHref.startsWith('/web/geek/jobs')
            if (!safeHref || location.pathname !== '/web/geek/jobs') {
                this.logRecorder.warn(`求职期望【${entry.key}】的切换控件不安全，已跳过，禁止自动切到首页`)
                this.visitedExpectationKeys.add(entry.key)
                continue
            }
            this.logRecorder.info(`当前职位已处理完，自动切换求职期望：【${entry.key}】`)
            liveEntry.element.click()

            for (let attempt = 0; attempt < 20; attempt++) {
                await Tools.sleep(500)
                if (location.pathname !== '/web/geek/jobs') {
                    this.logRecorder.error(`求职期望【${entry.key}】触发了异常页面跳转，已停止自动投递，避免继续切换页面`)
                    this.pushStatus = PushStatus.PAUSE
                    return false
                }
                const afterIds = this.getVisibleJobIdentities()
                const changed = Array.from(afterIds).some(id => !beforeIds.has(id))
                if (changed && this.getJobList().length > 0) {
                    this.currentExpectationKey = entry.key
                    this.lastHeight = 0
                    return true
                }
            }
            this.logRecorder.info(`求职期望【${entry.key}】没有新的可用职位，继续切换`)
            this.visitedExpectationKeys.add(entry.key)
        }

        this.logRecorder.info("所有求职期望均已处理完成")
        return false
    }


    async matchJob(jobDetail: BossJobDetail) {
        const jobTitle = this.getJobKey(jobDetail)
        // 永久硬屏蔽优先级最高，不受可编辑偏好开关影响。
        if (Tools.isHardBlockedCompany(jobDetail.brandName)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '命中本地永久硬屏蔽公司（潮一相关）')
        }
        // 已经沟通过
        if (jobDetail.contact) {
            throw new NotMatchException(jobTitle, jobDetail.contact, '已经沟通过')
        }
        // 过滤猎头
        if (userStore.user.preference.fhE && jobDetail.goldHunter === 1) {
            throw new NotMatchException(jobTitle, jobDetail.goldHunter, '过滤猎头')
        }
        // 仅投递在线boss
        if (userStore.user.preference.polE && !jobDetail.bossOnline) {
            throw new NotMatchException(jobTitle, jobDetail.bossOnline, '仅投递在线boss')
        }

        // 不满足配置公司名
        let companyNameInclude: string[] = userStore.user.preference.cni;
        if (userStore.user.preference.cniE && !Tools.fuzzyMatch(companyNameInclude, jobDetail.brandName, true)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '不满足配置公司名')
        }

        // 满足排除公司名
        let companyNameExclude: string[] = userStore.user.preference.cne;
        if (userStore.user.preference.cneE && Tools.fuzzyMatch(companyNameExclude, jobDetail.brandName, false)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '满足排除公司名')
        }

        // 满足排除工作名
        let jobNameExclude: string[] = userStore.user.preference.jne;
        if (userStore.user.preference.jneE && Tools.fuzzyMatch(jobNameExclude, jobDetail.jobName, false)) {
            throw new NotMatchException(jobTitle, jobDetail.jobName, '满足排除工作名')
        }

        // 只要填写了薪资范围，就把它作为硬限制；不能被旧版 srE=false 迁移值绕过。
        const configuredSalaryRange = String(userStore.user.preference.sr || '').trim()
        const pageSalaryRange = String(jobDetail.salaryDesc || '').split(".")[0]
        if (configuredSalaryRange
            && !isSalaryWithinConfiguredRange(configuredSalaryRange, pageSalaryRange)) {
            throw new NotMatchException(jobTitle, pageSalaryRange || '薪资未知',
                `不满足薪资硬范围 ${configuredSalaryRange}K`)
        }

        // 公司规模
        let pageCompanyScaleRange = userStore.user.preference.csr;
        if (userStore.user.preference.csrE && !Tools.isRangeOverlap(pageCompanyScaleRange, jobDetail.brandScaleName)) {
            throw new NotMatchException(jobTitle, jobDetail.brandScaleName, '不满足公司规模范围')
        }

        // 通过接口获取工作详情扩展信息
        let jobDetailExt = await this.obtainBossJobDetailExt(jobDetail);
        logger.debug(`获取工作【${jobTitle}】详情扩展信息用于过滤 `, jobDetail)

        //  活跃度
        let activeTimeDesc = jobDetailExt.activeTimeDesc;
        if (!this.bossIsActive(activeTimeDesc)) {
            // HR近期不活跃只降低优先级，不得在“不限量投递”模式下直接卡掉待遇合适的岗位。
            this.logRecorder.info(`工作【${jobTitle}】Boss活跃度较低（${activeTimeDesc}），已作为参考继续投递`)
        }

        // 工作内容排除
        let jobContent = jobDetailExt.postDescription;
        let jobContentExclude: string[] = userStore.user.preference.jce;
        if (userStore.user.preference.jceE && Tools.fuzzyMatch(jobContentExclude, jobContent, false)) {
            throw new NotMatchException(jobTitle, jobContent, '满足排除工作内容')
        }

        // 工作内容包含
        let jobContentInclude: string[] = userStore.user.preference.jci;
        if (userStore.user.preference.jciE && !Tools.fuzzyMatch(jobContentInclude, jobContent, true)) {
            throw new NotMatchException(jobTitle, jobContent, '不满足工作内容')
        }

        const jobTitleDecision = evaluateJobTitleRule({
            jobName: jobDetail.jobName,
            postDescription: jobContent,
            includeKeywords: userStore.user.preference.jni,
            excludeKeywords: userStore.user.preference.jneE ? userStore.user.preference.jne : [],
            mode: userStore.user.preference.jobTitleMatchMode
                || (userStore.user.preference.jniE ? 'required' : 'off'),
        })
        if (jobTitleDecision.status === 'SKIP') {
            throw new NotMatchException(jobTitle, jobTitleDecision.reason, '岗位名规则')
        }

        const academicMismatch = this.detectMandatoryAcademicMismatch(jobDetail, jobContent)
        if (academicMismatch) {
            throw new NotMatchException(jobTitle, academicMismatch, '硬学历门槛')
        }

        const benefitText = this.buildBenefitText(jobDetail, jobDetailExt)
        if (userStore.user.preference.weekendMode === 'required' && !this.hasWeekendBenefit(benefitText)) {
            throw new NotMatchException(jobTitle, '岗位未明确标注双休', '不满足周末双休要求')
        }
        if (userStore.user.preference.insuranceMode === 'required' && !this.hasInsuranceBenefit(benefitText)) {
            throw new NotMatchException(jobTitle, '岗位未明确标注五险一金', '不满足五险一金要求')
        }
        const commuteLocations = userStore.user.preference.commuteLocations || []
        if (userStore.user.preference.commuteMode === 'required' && commuteLocations.length > 0
            && !this.matchesCommuteLocation(jobDetail, jobDetailExt)) {
            throw new NotMatchException(jobTitle, jobDetailExt.address || jobDetail.businessDistrict, '不满足通勤位置要求')
        }

        // 默认用本地规则完成简历-JD评分；不调用任何外部 AI 或付费接口。
        // 通勤、双休、五险一金等硬规则已在此前独立执行，评分不会覆盖。
        const snapshotJobBaseInfo = JSON.stringify(this.unpackBaseInfo(jobDetail))
        const snapshotJobExtInfo = JSON.stringify(this.unpackExtInfo(jobDetailExt))
        let preMatchResult: unknown = {
            decisionStatus: 'MATCH',
            engine: 'BROWSER_RULES',
            reason: jobTitleDecision.reason,
            titleStatus: jobTitleDecision.status,
            matchedKeywords: jobTitleDecision.matchedKeywords,
        }
        const resumeMatchEnabled = userStore.user.preference.resumeMatchE
        if (resumeMatchEnabled) {
            const jobBaseInfo = snapshotJobBaseInfo
            const jobExtInfo = snapshotJobExtInfo
            const minMatchScore = userStore.user.preference.resumeMatchMinScore
            const cacheKey = this.buildAiFilterCacheKey([
                'local-rules-v2',
                String(userStore.user.resumeId || ''),
                String(resumeMatchEnabled),
                String(minMatchScore),
                jobBaseInfo,
                jobExtInfo,
                jobTitleDecision.status,
                ...jobTitleDecision.matchedKeywords,
            ])
            let filterResult = this.getCachedAiFilterResult(cacheKey)

            if (filterResult) {
                this.logRecorder.info(`工作【${jobTitle}】使用本地JD评分缓存`)
            } else {
                try {
                    const filterResp = await AiPower.filter(
                        '',
                        jobBaseInfo,
                        jobExtInfo,
                        resumeMatchEnabled,
                        minMatchScore,
                        jobTitleDecision.status,
                        jobTitleDecision.matchedKeywords,
                    )
                    filterResult = normalizeAiJobDecision(filterResp?.data?.data)
                    this.cacheAiFilterResult(cacheKey, filterResult)
                } catch (error: any) {
                    logger.warn(`工作【${jobTitle}】岗位决策请求失败`, error)
                    filterResult = normalizeAiJobDecision({
                        decisionStatus: 'UNKNOWN',
                        reason: `AI 服务请求失败：${error?.message || '未知错误'}`,
                    })
                }
            }
            if (resumeMatchEnabled && Number.isFinite(filterResult?.score)) {
                const source = filterResult.engine?.startsWith('LOCAL_RULES') ? '本地规则' : 'AI'
                const breakdown = Number.isFinite(filterResult.skillScore)
                    ? `，技能${filterResult.skillScore}分，置信度${filterResult.confidence || 'LOW'}` : ''
                this.logRecorder.info(`工作【${jobTitle}】简历-JD匹配度：${filterResult.score}分（${source}${breakdown}）`)
            }
            if (!filterResult || filterResult.status === 'UNKNOWN') {
                throw new AiDecisionUnknownExp(jobTitle, filterResult?.reason || '未获得简历-JD匹配结果，需要人工确认')
            }
            if (filterResult.status === 'REJECT') {
                const source = filterResult.engine?.startsWith('LOCAL_RULES') ? '本地简历匹配' : 'AI过滤'
                throw new NotMatchException(jobTitle, filterResult.reason, source)
            }
            preMatchResult = filterResult
        }

        // 重新检测投递（页面点击投递后，页面数据不会变，所有标签中获取到的是否沟通过有可能是旧的，需要重新校验）
        if (this.isCommunication(jobDetailExt)) {
            throw new NotMatchException(jobTitle, jobDetailExt.friendStatus, '已经沟通过')
        }

        this.applicationSnapshotContexts.set(String(jobDetail.encryptJobId), {
            encryptJobId: String(jobDetail.encryptJobId),
            jobBaseInfo: snapshotJobBaseInfo,
            jobExtInfo: snapshotJobExtInfo,
            preMatchResult,
        })

        return true;
    }

    unpackBaseInfo(jobDetail: BossJobDetail): {} {
        return {
            jobName: jobDetail.jobName,
            salaryDesc: jobDetail.salaryDesc,
            jobLabels: jobDetail.jobLabels,
            skills: jobDetail.skills,
            jobExperience: jobDetail.jobExperience,
            jobDegree: jobDetail.jobDegree,
            cityName: jobDetail.cityName,
            areaDistrict: jobDetail.areaDistrict,
            businessDistrict: jobDetail.businessDistrict,
            brandName: jobDetail.brandName,
            brandStageName: jobDetail.brandStageName,
            brandIndustry: jobDetail.brandIndustry,
            brandScaleName: jobDetail.brandScaleName,
            welfareList: jobDetail.welfareList,
            daysPerWeekDesc: jobDetail.daysPerWeekDesc,
        }
    }
    unpackExtInfo(jobDetailExt: any): {} {
        return {
            postDescription: jobDetailExt.postDescription,
            address: jobDetailExt.address,
            activeTimeDesc: jobDetailExt.activeTimeDesc
        }
    }

    pausePush() {
        this.pushStatus = PushStatus.PAUSE
    }

    getJobKey(jobDetail: BossJobDetail): string {
        return jobDetail.jobName + "-" + jobDetail.cityName + jobDetail.areaDistrict + jobDetail.businessDistrict;
    }


    isLimit(jobDetail: JobDetail): { limit: boolean; msg: string } {
        const dailyLimitKey = makeBossDailyLimitKey()
        const storedLimit = TampermonkeyApi.GmGetValue(dailyLimitKey, false)
        if (isLegacyLocalDailyLimit(storedLimit)) {
            // Remove the obsolete fixed-cap marker without touching a genuine
            // platform limit recorded for today.
            TampermonkeyApi.GmSetValue(dailyLimitKey, false)
        } else if (storedLimit) {
            return {
                limit: true,
                msg: typeof storedLimit === 'string'
                    ? storedLimit
                    : "BOSS 今日沟通人数已达平台上限",
            }
        }

        return {
            limit: false,
            msg: ""
        }
    }

    private stopForBossDailyLimit(value: unknown) {
        const signal = detectBossDailyLimit(value)
        if (!signal) return null
        // 复用既有 push_limitYYYY-MM-DD GM 标记；自然日变化后读取新键，自动恢复。
        TampermonkeyApi.GmSetValue(makeBossDailyLimitKey(), signal.reason)
        this.pausePush()
        return signal
    }

    /**
     * 所有标签页共享固定冷却。Web Locks 可避免两个职位页同时越过时间戳检查；
     * 不可用时仍执行相同固定间隔，不做随机化或规避检测。
     */
    private async runWithGlobalPushCooldown<T>(operation: () => Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
            const configuredSeconds = Math.max(
                SAFE_MIN_PUSH_INTERVAL_SECONDS,
                Number(userStore.user.preference.pi) || 0,
            )
            const lastPushAt = Number(TampermonkeyApi.GmGetValue(BOSS_LAST_PUSH_AT_KEY, 0)) || 0
            const waitMs = calculatePushCooldownMs(lastPushAt, configuredSeconds)
            if (waitMs > 0) await Tools.sleep(waitMs)

            const riskStop = getBossRiskStop()
            if (riskStop) throw new PublishLimitExp(`BOSS风控熔断：${riskStop.reason}`)
            const currentLimit = this.isLimit({} as JobDetail)
            if (currentLimit.limit) throw new PublishLimitExp(currentLimit.msg)

            TampermonkeyApi.GmSetValue(BOSS_LAST_PUSH_AT_KEY, Date.now())
            return await operation()
        }

        const lockManager = (globalThis.navigator as any)?.locks
        if (lockManager?.request) {
            return await lockManager.request('ai-job-hunting-boss-friend-add', run)
        }
        return await run()
    }

    async doPush(jobDetail: BossJobDetail): Promise<any> {
        const jobTitle = this.getJobKey(jobDetail)
        const activeRiskStop = getBossRiskStop()
        if (activeRiskStop) throw new PublishLimitExp(`BOSS风控熔断：${activeRiskStop.reason}`)

        // 在真正调用 BOSS 投递接口前再次校验，避免异步配置或页面数据变化绕过 matchJob。
        if (Tools.isHardBlockedCompany(jobDetail.brandName)) {
            throw new NotMatchException(jobTitle, jobDetail.brandName, '命中本地永久硬屏蔽公司（潮一相关）')
        }

        logger.debug("正在投递：" + jobTitle)

        // 投递请求url
        let publishUrl = `https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=` +
            `${jobDetail.securityId}&jobId=${jobDetail.encryptJobId}&lid=${jobDetail.lid}`

        let pushResp: any = {code: PushResultStatus.NOT_START, message: ""};
        try {
            pushResp = await this.runWithGlobalPushCooldown(() => axiosOriginal.post(publishUrl, null, {
                    headers: {"Zp_token": Tools.getCookieValue("bst")},
                    timeout: 6000,
                }),
            );
        } catch (error: any) {
            const dailyLimit = this.stopForBossDailyLimit(error)
            if (dailyLimit) throw new PublishLimitExp(dailyLimit.reason)
            const risk = tripBossRiskCircuit(error)
            if (risk) throw new PublishLimitExp(`BOSS风控熔断：${risk.reason}`)
            // 发起沟通属于有副作用请求：网络异常时不自动重试，避免重复请求。
            throw new PushReqException(jobTitle, error?.message || '发起沟通请求失败')
        }

        const responseRisk = tripBossRiskCircuit(pushResp)
        if (responseRisk) throw new PublishLimitExp(`BOSS风控熔断：${responseRisk.reason}`)

        const dailyLimit = this.stopForBossDailyLimit(pushResp)
        if (dailyLimit) throw new PublishLimitExp(dailyLimit.reason)

        if (pushResp.data.code === PushResultStatus.FAIL && pushResp.data?.zpData?.bizData?.chatRemindDialog?.content) {
            // BOSS 的开聊提示既可能是普通提醒，也可能是今日平台上限。
            // 某些条件不满足，boss限制投递，无需重试，在结果处理器中处理
            return {
                code: 1,
                message: pushResp.data?.zpData?.bizData?.chatRemindDialog?.content
            }
        }
        // 避免频繁
        await Tools.sleep(800);
        return pushResp.data;
    }

    private bossDataCache: Map<string, any> = new Map();

    private async requestBossDataByCache(jobDetail: BossJobDetail): Promise<any> {
        let cacheKey = `${jobDetail.encryptBossId}-${jobDetail.securityId}`;

        // 先检查缓存中是否有数据
        if (this.bossDataCache.has(cacheKey)) {
            return this.bossDataCache.get(cacheKey);
        }

        // 缓存请求结果
        const result = await this.requestBossData(jobDetail);
        this.bossDataCache.set(cacheKey, result);
        return result;
    }

    async requestBossData(jobDetail: BossJobDetail, errorMsg: string = "", retries = 3): Promise<any> {
        let jobTitle = this.getJobKey(jobDetail);
        const activeRiskStop = getBossRiskStop()
        if (activeRiskStop) throw new PublishLimitExp(`BOSS风控熔断：${activeRiskStop.reason}`)

        if (retries === 0) {
            throw new FetchJobBossFailExp(jobTitle, errorMsg || "获取boss数据重试多次失败");
        }
        const url = "https://www.zhipin.com/wapi/zpchat/geek/getBossData";
        const token = Tools.getCookieValue("bst");
        if (!token) {
            throw new FetchJobBossFailExp(jobTitle, "未获取到zp-token");
        }

        const data = new FormData();
        data.append("bossId", jobDetail.encryptBossId);
        data.append("securityId", jobDetail.securityId);
        data.append("bossSrc", "0");

        let resp: any;
        try {
            resp = await axiosOriginal({
                url,
                data,
                method: "POST",
                headers: {Zp_token: token},
                timeout: 5000,
            });
        } catch (e: any) {
            const risk = tripBossRiskCircuit(e)
            if (risk) throw new PublishLimitExp(`BOSS风控熔断：${risk.reason}`)
            await Tools.sleep((4 - retries) * 500)
            return this.requestBossData(jobDetail, e.message, retries - 1);
        }

        const responseRisk = tripBossRiskCircuit(resp)
        if (responseRisk) throw new PublishLimitExp(`BOSS风控熔断：${responseRisk.reason}`)

        if (resp.data.code !== 0) {
            throw new FetchJobBossFailExp(jobTitle, resp.data.message);
        }
        return resp.data.zpData
    }


    async pushAfterHandler(pushResult: PushResult, jobDetail: BossJobDetail): Promise<any> {
        const jobTitle = this.getJobKey(jobDetail)

        const dailyLimit = this.stopForBossDailyLimit(pushResult)
        if (dailyLimit) throw new PublishLimitExp(dailyLimit.reason)

        if (pushResult.message === 'Success' && pushResult.code === 0) {
            pushResultCounter.successIncr()
            this.logRecorder.info(`工作【${jobTitle}】已发起沟通（不代表招呼语已送达）`)

            const snapshotKey = String(jobDetail.encryptJobId)
            const snapshotContext = this.applicationSnapshotContexts.get(snapshotKey)
            if (snapshotContext) {
                void saveApplicationSnapshotWithRetry({...snapshotContext, appliedAt: Date.now()}).then(() => {
                    if (this.applicationSnapshotContexts.get(snapshotKey) === snapshotContext) {
                        this.applicationSnapshotContexts.delete(snapshotKey)
                    }
                }).catch(error => {
                    const errorCode = error?.code || error?.response?.status || 'UNKNOWN'
                    this.logRecorder.warn(`工作【${jobTitle}】投递快照多次保存失败（${errorCode}），已保留上下文和投递成功状态`)
                })
            } else {
                this.logRecorder.warn(`工作【${jobTitle}】投递成功但缺少快照上下文，已保留投递成功状态`)
            }

            // BOSS 只有双方都回复后才允许发送简历。首次沟通阶段只发送
            // 自定义招呼语，禁止尝试发送图片/附件简历。
            if (userStore.user.preference.cIE && userStore.user.preference.cI) {
                this.logRecorder.info(`工作【${jobTitle}】图片简历已等待双方回复后再发送`)
            }
            try {
                // 投递后发送自定义消息
                await this.pushAfterSendMsg(jobDetail);
            } catch (e: any) {
                this.logRecorder.error(`工作【${jobTitle}】自定义招呼语发送失败`, e?.message || e)
            }

            // 标记为已沟通，在推荐页面中下一页会获取之前的数据，所以需要标记为已沟通
            jobDetail.contact = true
            return jobDetail
        }

        throw new PushReqException(jobTitle, pushResult.message)
    }

    /**
     * 投递后发送自定义消息
     */
    async pushAfterSendMsg(jobDetail: BossJobDetail) {
        const greetingMode = normalizeGreetingDeliveryMode(
            userStore.user.preference.greetingDeliveryMode,
            !!userStore.user.preference.cgE,
            userStore.user.preference.cg,
        )
        if (!customGreetingEnabled(greetingMode) || this._pushMock || Tools.isHardBlockedCompany(jobDetail.brandName)) {
            if (Tools.isHardBlockedCompany(jobDetail.brandName)) {
                this.logRecorder.warn(`工作【${this.getJobKey(jobDetail)}】命中潮一硬屏蔽，禁止发送自定义招呼语`)
            }
            return;
        }
        let customGreeting = userStore.user.preference.cg;
        const entry: PendingGreeting = {
            // 必须在第一次 await 之前写入队列：页面即使此刻被 BOSS 刷新、
            // 自动翻页或浏览器关闭，聊天页的重试 worker 仍能恢复并补发。
            key: makeGreetingTaskKey(jobDetail.encryptBossId),
            jobTitle: this.getJobKey(jobDetail),
            brandName: jobDetail.brandName,
            toName: jobDetail.encryptBossId,
            content: customGreeting,
            createdAt: Date.now(),
            attempts: 0,
            clientMid: Message.createClientMid(),
            conversationKey: makeConversationKey(jobDetail.encryptBossId, jobDetail.securityId),
            bossLookup: {
                encryptBossId: jobDetail.encryptBossId,
                securityId: jobDetail.securityId,
            },
        }
        // 先持久化再做任何异步查询；浏览器刷新或通道暂时断开都不会丢任务。
        this.enqueueGreeting(entry)
        const sent = await this.deliverPendingGreeting(entry, greetingRequiresReadyChannel(greetingMode))
        if (!sent) {
            this.logRecorder.warn(`工作【${this.getJobKey(jobDetail)}】自定义招呼语已进入自动补发队列`)
        }
    }

    /**
     * 旧版首次沟通后发送图片简历的兼容入口。
     *
     * BOSS 首次沟通阶段并没有发送简历权限，因此这里永久保持为 no-op，
     * 防止旧配置、旧调用方或以后重构时再次误发。真正的附件简历只能由
     * bossPlatform 的聊天回复流程在收到 Boss 回复后按官方交换接口发送。
     */
    async pushAfterSendImage(jobDetail: BossJobDetail) {
        this.logRecorder.warn(`工作【${this.getJobKey(jobDetail)}】处于首次沟通阶段，已阻止发送图片/附件简历`)
    }

    pushPreHandler(jobDetail: JobDetail): JobDetail {
        return jobDetail;
    }

    async obtainBossJobDetailExt(
        jobDetail: BossJobDetail,
        message = '',
        retries = 3,
        lastCode = 'DETAIL_UNAVAILABLE',
    ): Promise<any> {

        const activeRiskStop = getBossRiskStop()
        if (activeRiskStop) throw new PublishLimitExp(`BOSS风控熔断：${activeRiskStop.reason}`)

        if (retries === 0) {
            logger.warn(`获取工作详情扩展信息异常,用于活跃度过滤以及工作内容过滤; 原因：${message}`)
            throw new JobDetailUnavailableExp(this.getJobKey(jobDetail), lastCode, message || "获取工作详情扩展信息异常")
        }
        const params = buildBossJobCardQuery(jobDetail)
        try {
            let resp = await axiosOriginal.get("https://www.zhipin.com/wapi/zpgeek/job/card.json?" + params, {timeout: 5000})
            const responseRisk = tripBossRiskCircuit(resp)
            if (responseRisk) throw new PublishLimitExp(`BOSS风控熔断：${responseRisk.reason}`)
            return parseBossJobCardResponse(resp.data)
        } catch (error: any) {
            if (error instanceof PublishLimitExp) throw error
            const risk = tripBossRiskCircuit(error)
            if (risk) throw new PublishLimitExp(`BOSS风控熔断：${risk.reason}`)
            logger.debug("获取详情页异常正在重试:", error)
            const code = error instanceof BossContractError ? error.code : 'DETAIL_NETWORK_ERROR'
            return this.obtainBossJobDetailExt(jobDetail, error.message, retries - 1, code)
        }
    }

    bossIsActive(activeText: string) {
        return !(activeText.includes("月") || activeText.includes("年") || activeText.includes("周"));
    }

    isCommunication(jobCardJson: any) {
        return jobCardJson?.friendStatus === 1;
    }


}

const platformList: any[] = [BossPlatform]


class PlatformFactory {
    public static getInstance(url: string): Platform {
        for (const PlatformClass of platformList) {
            const platformInstance = new PlatformClass(url) as Platform;
            if (platformInstance.urlList.some(platformUrl => url.includes(platformUrl))) {
                // 计数器赋值
                pushResultCounter = pushResultCount();
                userStore = UserStore();
                userStore.platformType = platformInstance.getPlatformType();
                userRemoteLoad()
                return platformInstance;
            }
        }
        throw new PlatformError(PlatformTypeEnum.UnKnow, "错误的平台");
    }
}


export default PlatformFactory
