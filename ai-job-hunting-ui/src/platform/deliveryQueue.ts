export type RetryQueueEntry = {
    key: string,
    conversationKey?: string,
    bossId?: string | number,
    attempts?: number,
    acknowledgedAt?: number,
    dispatchedAt?: number,
    manualReviewAt?: number,
    serverMid?: string,
}

export type InboundTrackedDelivery = RetryQueueEntry & {
    inboundMessageId?: string,
    inboundTextKey?: string,
}

export const DELIVERY_MAX_ATTEMPTS = 3
export const DELIVERY_GATE_MAX_WAIT_MS = 2 * 60 * 1000
export const DELIVERY_UNCERTAIN_RECONCILE_MS = 2 * 60 * 1000

export function hasDeliveryGateTimedOut(
    startedAt: number,
    now = Date.now(),
    maxWaitMs = DELIVERY_GATE_MAX_WAIT_MS,
): boolean {
    return Number.isFinite(startedAt) && now - startedAt >= Math.max(0, maxWaitMs)
}

/** Only a BOSS serverMid is authoritative enough to claim that an outgoing reply was accepted. */
export function hasServerAcknowledgement(entry: RetryQueueEntry): boolean {
    return !!String(entry.serverMid || '').trim()
}

/** Acknowledged entries stay persisted for receipt reconciliation, but must never be sent again. */
export function isAwaitingDeliveryReceipt(entry: RetryQueueEntry): boolean {
    // acknowledgedAt is diagnostic metadata only; without serverMid an interrupted write
    // must remain retryable with the same clientMid.
    return hasServerAcknowledgement(entry)
}

/** The SDK accepted a side-effecting send, but no authoritative BOSS ACK was observed yet. */
export function isDispatchUncertain(entry: RetryQueueEntry): boolean {
    return !hasServerAcknowledgement(entry)
        && Number(entry.dispatchedAt || 0) > 0
        && Number(entry.manualReviewAt || 0) <= 0
}

/** Unknown outcomes remain persisted and permanently ineligible for automatic resend. */
export function isManualReviewDelivery(entry: RetryQueueEntry): boolean {
    return !hasServerAcknowledgement(entry) && Number(entry.manualReviewAt || 0) > 0
}

/**
 * A missing ACK is not enough to retry a side effect. The BOSS chat list can,
 * however, provide stronger evidence by explicitly showing that the exact
 * conversation was created without any greeting. Keep a short grace period so
 * a slow UI update cannot turn a successful send into a duplicate.
 */
export function canRetryAfterConfirmedUngreeted(
    entry: RetryQueueEntry,
    observedAt: number = Date.now(),
    confirmationGraceMs = 30_000,
): boolean {
    const dispatchedAt = Number(entry.dispatchedAt || 0)
    return !hasServerAcknowledgement(entry)
        && dispatchedAt > 0
        && observedAt - dispatchedAt >= confirmationGraceMs
        && (isDispatchUncertain(entry) || isManualReviewDelivery(entry))
}

export function shouldMoveUncertainToManualReview(
    entry: RetryQueueEntry,
    now = Date.now(),
    maxWaitMs = DELIVERY_UNCERTAIN_RECONCILE_MS,
): boolean {
    const dispatchedAt = Number(entry.dispatchedAt || 0)
    return isDispatchUncertain(entry)
        && Number.isFinite(dispatchedAt)
        && now - dispatchedAt >= Math.max(0, maxWaitMs)
}

/** Only a never-dispatched entry below the retry ceiling may occupy the send worker. */
export function isRetryableDelivery(
    entry: RetryQueueEntry,
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): boolean {
    return !isAwaitingDeliveryReceipt(entry)
        && !isDispatchUncertain(entry)
        && !isManualReviewDelivery(entry)
        && Number(entry.attempts || 0) < maxAttempts
}

export function isExhaustedDelivery(
    entry: RetryQueueEntry,
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): boolean {
    return !isAwaitingDeliveryReceipt(entry)
        && !isDispatchUncertain(entry)
        && !isManualReviewDelivery(entry)
        && Number(entry.attempts || 0) >= maxAttempts
}

/**
 * Do not pass `isExhaustedDelivery` directly to Array.filter: filter's second
 * argument is the array index and would silently replace `maxAttempts`.
 */
export function findExhaustedDeliveries<T extends RetryQueueEntry>(queue: T[]): T[] {
    return queue.filter(entry => isExhaustedDelivery(entry))
}

export function findNextRetryableDelivery<T extends RetryQueueEntry>(
    queue: T[],
    sendingKeys: ReadonlySet<string> = new Set<string>(),
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): T | undefined {
    return queue.find(entry => !sendingKeys.has(entry.key) && isRetryableDelivery(entry, maxAttempts))
}

export function deliveryScopeKey(entry: RetryQueueEntry): string {
    const bossId = String(entry.bossId ?? '').trim()
    if (bossId) return `boss:${bossId}`
    // Greeting keys deliberately exclude BOSS's rotating securityId.
    if (String(entry.key || '').startsWith('greeting:')) return String(entry.key)
    return String(entry.conversationKey || entry.key)
}

/**
 * A manual-review outcome must not freeze unrelated conversations, but later
 * automation in that same conversation stays paused until a human reconciles it.
 */
export function findNextRetryableOutsideUnknownScopes<T extends RetryQueueEntry>(
    queue: T[],
    sendingKeys: ReadonlySet<string> = new Set<string>(),
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): T | undefined {
    const blockedScopes = new Set(queue
        .filter(entry => isDispatchUncertain(entry) || isManualReviewDelivery(entry))
        .map(deliveryScopeKey))
    return queue.find(entry => !blockedScopes.has(deliveryScopeKey(entry))
        && !sendingKeys.has(entry.key)
        && isRetryableDelivery(entry, maxAttempts))
}

/**
 * Keeps DOM recovery from generating a second reply while the original WS reply is
 * retrying. Exhausted entries deliberately do not match so the unread row can recover.
 */
export function findActiveReplyForInbound<T extends InboundTrackedDelivery>(
    queue: T[],
    bossId: string | number,
    inboundMessageId: string,
    inboundTextKey: string,
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): T | undefined {
    const normalizedBossId = String(bossId)
    const legacyKey = `${normalizedBossId}:${inboundMessageId}`
    return queue.find(entry => !isExhaustedDelivery(entry, maxAttempts)
        && String(entry.bossId ?? normalizedBossId) === normalizedBossId
        && (entry.inboundMessageId === inboundMessageId
            || (!!inboundTextKey && entry.inboundTextKey === inboundTextKey)
            || entry.key === legacyKey))
}

/** Queued and dispatch-uncertain entries remain visible blockers; ACKed/terminal entries do not. */
export function countBlockingDeliveries(
    queue: RetryQueueEntry[],
    maxAttempts = DELIVERY_MAX_ATTEMPTS,
): number {
    return queue.filter(entry => isRetryableDelivery(entry, maxAttempts)
        || isDispatchUncertain(entry)).length
}

/** A disabled AI seat keeps its retry queue for later recovery without blocking job applications. */
export function countDeliveryGateBlockers(
    greetingQueue: RetryQueueEntry[],
    aiReplyQueue: RetryQueueEntry[],
    aiRepliesEnabled: boolean,
): number {
    return countBlockingDeliveries(greetingQueue)
        + (aiRepliesEnabled ? countBlockingDeliveries(aiReplyQueue) : 0)
}
