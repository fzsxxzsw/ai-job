export type ManualTakeoverFenceStatus =
    'PROVISIONAL' | 'CONFIRMED' | 'ACTIVE' | 'SYNC_FAILED' | 'PERMANENT_PAUSED'

export type ManualTakeoverFence = {
    schemaVersion: 1,
    status: ManualTakeoverFenceStatus,
    account: string,
    bossId: string,
    clientMid: string,
    serverMid?: string,
    manualText: string,
    manualSentAt: number,
    throughInboundMessageId: string,
    throughInboundSentAt: number | null,
    throughInboundText: string,
    conversationKey: string | null,
    encryptJobId?: string,
    jobKey?: string,
    uncertain: boolean,
    createdAt: number,
    updatedAt: number,
    expiresAt?: number,
    errorCode?: string,
}

export type ManualTakeoverInbound = {
    account: string,
    bossId: string,
    mid: string,
    sentAt: number | null,
    text: string,
    conversationKey: string | null,
    uncertain?: boolean,
}

export type ManualTakeoverPayload = {
    requestId: string,
    platformAccount: string,
    conversationKey: string,
    encryptJobId: string,
    bossId: string,
    jobKey: string,
    throughInboundMessageId: string,
    throughInboundSentAt: number | null,
    throughInboundText: string,
    manualOutboundClientMid: string,
    manualOutboundMessageId: string,
    manualOutboundSentAt: number,
    manualText: string,
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const FENCE_PREFIX = 'ai-job-manual-takeover-v1:fence:'
const INBOUND_PREFIX = 'ai-job-manual-takeover-v1:inbound:'
// Content-only echo matching is bounded, but the provisional fence itself is
// not. Only exact platform/server evidence may advance or clear that fence.
const ECHO_MATCH_WINDOW_MS = 10 * 60_000
const activationPromises = new Map<string, Promise<unknown>>()

function scoped(prefix: string, account: string, bossId: string): string {
    return `${prefix}${encodeURIComponent(account)}:${encodeURIComponent(bossId)}`
}

function storageOrDefault(storage?: StorageLike): StorageLike {
    if (storage) return storage
    return globalThis.localStorage
}

function parse<T>(storage: StorageLike, key: string): T | undefined {
    try {
        const raw = storage.getItem(key)
        const value = raw ? JSON.parse(raw) : null
        return value && typeof value === 'object' ? value as T : undefined
    } catch (_) {
        return undefined
    }
}

function write(storage: StorageLike, key: string, value: unknown): void {
    storage.setItem(key, JSON.stringify(value))
}

function fenceKey(account: string, bossId: string): string {
    return scoped(FENCE_PREFIX, account, bossId)
}

function inboundKey(account: string, bossId: string): string {
    return scoped(INBOUND_PREFIX, account, bossId)
}

export function observeManualTakeoverInbound(
    inbound: ManualTakeoverInbound,
    storage?: StorageLike,
): ManualTakeoverInbound {
    const target = storageOrDefault(storage)
    const key = inboundKey(inbound.account, inbound.bossId)
    const previous = parse<ManualTakeoverInbound>(target, key)
    const value = previous?.mid === inbound.mid
        ? {...previous, ...inbound, conversationKey: inbound.conversationKey || previous.conversationKey}
        : inbound
    write(target, key, value)
    return value
}

export function readManualTakeoverFence(
    account: string,
    bossId: string,
    storage?: StorageLike,
    _now = Date.now(),
): ManualTakeoverFence | undefined {
    const target = storageOrDefault(storage)
    const key = fenceKey(account, bossId)
    const value = parse<ManualTakeoverFence>(target, key)
    if (!value || value.schemaVersion !== 1 || value.account !== account || value.bossId !== bossId) {
        if (value) target.removeItem(key)
        return undefined
    }
    return value
}

export function recordProvisionalManualOutgoing(
    input: {account: string, bossId: string, clientMid: string, text: string, sentAt: number},
    storage?: StorageLike,
    now = Date.now(),
): ManualTakeoverFence {
    const target = storageOrDefault(storage)
    const inbound = parse<ManualTakeoverInbound>(target, inboundKey(input.account, input.bossId))
    const fence: ManualTakeoverFence = {
        schemaVersion: 1,
        status: 'PROVISIONAL',
        account: input.account,
        bossId: input.bossId,
        clientMid: input.clientMid,
        manualText: input.text,
        manualSentAt: input.sentAt,
        throughInboundMessageId: inbound?.mid || '',
        throughInboundSentAt: inbound?.sentAt ?? null,
        throughInboundText: inbound?.text || '',
        conversationKey: inbound?.conversationKey || null,
        uncertain: !!inbound?.uncertain,
        createdAt: now,
        updatedAt: now,
    }
    write(target, fenceKey(input.account, input.bossId), fence)
    return fence
}

export function confirmManualOutgoingEcho(
    input: {
        account: string,
        bossId: string,
        clientMid: string,
        serverMid: string,
        text: string,
        sentAt: number,
    },
    storage?: StorageLike,
    now = Date.now(),
): ManualTakeoverFence | undefined {
    if (!/^\d+$/.test(input.clientMid) || !/^\d+$/.test(input.serverMid)
        || BigInt(input.clientMid) <= 0n || BigInt(input.serverMid) <= 0n
        || input.clientMid === input.serverMid) return undefined
    const target = storageOrDefault(storage)
    const fence = readManualTakeoverFence(input.account, input.bossId, target, now)
    if (!fence || fence.status !== 'PROVISIONAL') return undefined
    const exactClient = !!input.clientMid && fence.clientMid === input.clientMid
    const recentContent = fence.manualText === input.text && now - fence.createdAt <= ECHO_MATCH_WINDOW_MS
    if (!exactClient && !recentContent) return undefined
    const confirmed: ManualTakeoverFence = {
        ...fence,
        status: 'CONFIRMED',
        clientMid: input.clientMid || fence.clientMid,
        serverMid: input.serverMid,
        manualSentAt: input.sentAt,
        updatedAt: now,
        expiresAt: undefined,
        errorCode: undefined,
    }
    write(target, fenceKey(input.account, input.bossId), confirmed)
    return confirmed
}

export function bindManualTakeoverFence(
    account: string,
    bossId: string,
    binding: {conversationKey: string, encryptJobId: string, jobKey: string},
    storage?: StorageLike,
): ManualTakeoverFence | undefined {
    const target = storageOrDefault(storage)
    const fence = readManualTakeoverFence(account, bossId, target)
    if (!fence) return undefined
    if ((fence.conversationKey && fence.conversationKey !== binding.conversationKey)
        || (fence.encryptJobId && fence.encryptJobId !== binding.encryptJobId)
        || (fence.jobKey && fence.jobKey !== binding.jobKey)) return undefined
    const bound = {...fence, ...binding, conversationKey: binding.conversationKey, updatedAt: Date.now()}
    write(target, fenceKey(account, bossId), bound)
    return bound
}

export async function dispatchManualTakeoverMode(
    unifiedEnabled: () => Promise<boolean>,
    handlers: {unified: () => Promise<void>, legacy: () => Promise<void>},
): Promise<'UNIFIED' | 'LEGACY_STOPPED'> {
    if (await unifiedEnabled()) {
        await handlers.unified()
        return 'UNIFIED'
    }
    await handlers.legacy()
    return 'LEGACY_STOPPED'
}

function updateFence(
    account: string,
    bossId: string,
    status: ManualTakeoverFenceStatus,
    storage?: StorageLike,
    errorCode?: string,
): ManualTakeoverFence | undefined {
    const target = storageOrDefault(storage)
    const fence = readManualTakeoverFence(account, bossId, target)
    if (!fence) return undefined
    const updated = {...fence, status, updatedAt: Date.now(), expiresAt: undefined, errorCode}
    write(target, fenceKey(account, bossId), updated)
    return updated
}

export function markManualTakeoverActive(account: string, bossId: string, storage?: StorageLike) {
    return updateFence(account, bossId, 'ACTIVE', storage)
}

export function markManualTakeoverPermanent(account: string, bossId: string, storage?: StorageLike) {
    return updateFence(account, bossId, 'PERMANENT_PAUSED', storage)
}

export function markManualTakeoverSyncFailed(
    account: string,
    bossId: string,
    errorCode = 'MANUAL_TAKEOVER_SYNC_FAILED',
    storage?: StorageLike,
) {
    return updateFence(account, bossId, 'SYNC_FAILED', storage, errorCode)
}

export function clearManualTakeoverFence(account: string, bossId: string, storage?: StorageLike): void {
    storageOrDefault(storage).removeItem(fenceKey(account, bossId))
}

export function manualFenceBlocks(account: string, bossId: string, storage?: StorageLike): boolean {
    return !!readManualTakeoverFence(account, bossId, storage)
}

type InboundRelation = 'NONE' | 'CURRENT' | 'STRICTLY_NEWER' | 'UNCERTAIN'

export function classifyManualTakeoverInbound(
    inbound: Pick<ManualTakeoverInbound, 'account' | 'bossId' | 'mid' | 'sentAt' | 'conversationKey'>,
    storage?: StorageLike,
): {relation: InboundRelation, fence?: ManualTakeoverFence} {
    const fence = readManualTakeoverFence(inbound.account, inbound.bossId, storage)
    if (!fence) return {relation: 'NONE'}
    if (fence.conversationKey && inbound.conversationKey
        && fence.conversationKey !== inbound.conversationKey) return {relation: 'UNCERTAIN', fence}
    if (fence.throughInboundMessageId === inbound.mid) return {relation: 'CURRENT', fence}
    if (fence.uncertain || fence.throughInboundSentAt === null || inbound.sentAt === null
        || inbound.sentAt <= fence.throughInboundSentAt) return {relation: 'UNCERTAIN', fence}
    return {relation: 'STRICTLY_NEWER', fence}
}

export function trackManualTakeoverActivation(
    account: string,
    bossId: string,
    promise: Promise<unknown>,
): void {
    const key = fenceKey(account, bossId)
    const tracked = promise.finally(() => {
        if (activationPromises.get(key) === tracked) activationPromises.delete(key)
    })
    activationPromises.set(key, tracked)
    void tracked.catch(() => undefined)
}

export function buildManualTakeoverPayload(
    fence: ManualTakeoverFence,
    requestId: string,
): ManualTakeoverPayload | undefined {
    if (!requestId || !fence.serverMid || !fence.conversationKey || !fence.encryptJobId || !fence.jobKey
        || !fence.throughInboundMessageId || !fence.throughInboundText || fence.uncertain
        || !/^\d+$/.test(fence.clientMid) || !/^\d+$/.test(fence.serverMid)
        || fence.clientMid === fence.serverMid) return undefined
    return {
        requestId,
        platformAccount: fence.account,
        conversationKey: fence.conversationKey,
        encryptJobId: fence.encryptJobId,
        bossId: fence.bossId,
        jobKey: fence.jobKey,
        throughInboundMessageId: fence.throughInboundMessageId,
        throughInboundSentAt: fence.throughInboundSentAt,
        throughInboundText: fence.throughInboundText,
        manualOutboundClientMid: fence.clientMid,
        manualOutboundMessageId: fence.serverMid,
        manualOutboundSentAt: fence.manualSentAt,
        manualText: fence.manualText,
    }
}

export async function synchronizeManualTakeoverFence(
    account: string,
    bossId: string,
    requestId: string,
    post: (payload: ManualTakeoverPayload) => Promise<any>,
    storage?: StorageLike,
): Promise<any> {
    const key = fenceKey(account, bossId)
    const pending = activationPromises.get(key)
    if (pending) return pending
    const target = storageOrDefault(storage)
    const operation = (async () => {
        const fence = readManualTakeoverFence(account, bossId, target)
        const payload = fence ? buildManualTakeoverPayload(fence, requestId) : undefined
        if (!payload) {
            markManualTakeoverSyncFailed(account, bossId, 'MANUAL_TAKEOVER_INBOUND_UNCERTAIN', target)
            throw new Error('MANUAL_TAKEOVER_INBOUND_UNCERTAIN')
        }
        try {
            const result = await post(payload)
            if (result?.permanentPaused) markManualTakeoverPermanent(account, bossId, target)
            else markManualTakeoverActive(account, bossId, target)
            return result
        } catch (error) {
            markManualTakeoverSyncFailed(account, bossId, 'MANUAL_TAKEOVER_SYNC_FAILED', target)
            throw error
        }
    })()
    trackManualTakeoverActivation(account, bossId, operation)
    return operation
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => globalThis.setTimeout(resolve, milliseconds))
}

export async function awaitManualTakeoverReadyForInbound(
    inbound: Pick<ManualTakeoverInbound, 'account' | 'bossId' | 'mid' | 'sentAt' | 'conversationKey'>,
    storage?: StorageLike,
    timeoutMs = 10_000,
): Promise<{allowed: boolean, candidate: boolean, reason?: string}> {
    const target = storageOrDefault(storage)
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (true) {
        const classified = classifyManualTakeoverInbound(inbound, target)
        if (classified.relation === 'NONE') return {allowed: true, candidate: false}
        if (classified.relation === 'CURRENT') {
            return {allowed: false, candidate: false, reason: 'MANUAL_TAKEOVER_ACTIVE'}
        }
        if (classified.relation === 'UNCERTAIN') {
            return {allowed: false, candidate: false, reason: 'INBOUND_ORDER_UNCERTAIN'}
        }
        const fence = classified.fence!
        if (fence.status === 'ACTIVE') return {allowed: true, candidate: true}
        if (fence.status === 'SYNC_FAILED' || fence.status === 'PERMANENT_PAUSED') {
            return {allowed: false, candidate: true, reason: fence.errorCode || fence.status}
        }
        if (Date.now() >= deadline) {
            return {allowed: false, candidate: true, reason: 'MANUAL_TAKEOVER_SYNC_PENDING'}
        }
        const pending = activationPromises.get(fenceKey(inbound.account, inbound.bossId))
        if (pending) await Promise.race([pending.catch(() => undefined), delay(100)])
        else await delay(50)
    }
}

export function consumeManualTakeoverAfterAcceptedInbound(
    inbound: Pick<ManualTakeoverInbound, 'account' | 'bossId' | 'mid' | 'sentAt' | 'conversationKey'>,
    storage?: StorageLike,
): boolean {
    const classified = classifyManualTakeoverInbound(inbound, storage)
    if (classified.relation !== 'STRICTLY_NEWER' || classified.fence?.status !== 'ACTIVE') return false
    clearManualTakeoverFence(inbound.account, inbound.bossId, storage)
    return true
}
