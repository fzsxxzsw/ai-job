import assert from 'node:assert/strict'
import test from 'node:test'
import {
    canRetryAfterConfirmedUngreeted,
    countBlockingDeliveries,
    countDeliveryGateBlockers,
    deliveryScopeKey,
    findActiveReplyForInbound,
    findExhaustedDeliveries,
    findNextRetryableDelivery,
    findNextRetryableOutsideUnknownScopes,
    hasDeliveryGateTimedOut,
    hasServerAcknowledgement,
    isAwaitingDeliveryReceipt,
    isDispatchUncertain,
    isExhaustedDelivery,
    isManualReviewDelivery,
    shouldMoveUncertainToManualReview,
} from './deliveryQueue.ts'
import {KeyedSerialExecutor} from './keyedSerialExecutor.ts'

test('acknowledged and exhausted entries cannot starve a later queued delivery', () => {
    const queue = [
        {key: 'ack', attempts: 0, acknowledgedAt: 1, serverMid: 'server-1'},
        {key: 'failed', attempts: 3},
        {key: 'next', attempts: 1},
    ]

    assert.equal(isAwaitingDeliveryReceipt(queue[0]), true)
    assert.equal(isExhaustedDelivery(queue[1]), true)
    assert.equal(findNextRetryableDelivery(queue)?.key, 'next')
    assert.equal(countBlockingDeliveries(queue), 1)
})

test('collecting exhausted deliveries never treats the array index as the retry limit', () => {
    const queue = [
        {key: 'fresh-at-index-zero', attempts: 0},
        {key: 'still-retryable', attempts: 2},
        {key: 'actually-exhausted', attempts: 3},
    ]

    assert.deepEqual(findExhaustedDeliveries(queue).map(entry => entry.key), ['actually-exhausted'])
})

test('acknowledged and terminal failures do not freeze the new-delivery gate', () => {
    assert.equal(countBlockingDeliveries([
        {key: 'ack', acknowledgedAt: Date.now(), serverMid: 'server-1'},
        {key: 'failed', attempts: 3},
    ]), 0)
})

test('disabled AI replies remain queued without blocking job applications', () => {
    const greetings = [{key: 'greeting', attempts: 0}]
    const activeAiReplies = [{key: 'ai-reply-active', attempts: 2}]
    const exhaustedAiReplies = [{key: 'ai-reply-failed', attempts: 3}]

    assert.equal(countDeliveryGateBlockers(greetings, activeAiReplies, false), 1)
    assert.equal(countDeliveryGateBlockers([], activeAiReplies, false), 0)
    assert.equal(countDeliveryGateBlockers([], activeAiReplies, true), 1)
    assert.equal(countDeliveryGateBlockers([], exhaustedAiReplies, true), 0)
})

test('persistence alone is not a server acknowledgement', () => {
    assert.equal(hasServerAcknowledgement({key: 'persisted', attempts: 0}), false)
    assert.equal(hasServerAcknowledgement({key: 'timestamp-only', acknowledgedAt: Date.now()}), false)
    assert.equal(hasServerAcknowledgement({key: 'acked', attempts: 0, serverMid: 'server-42'}), true)
})

test('an SDK-accepted dispatch without ACK is pending but never auto-retried or failed', () => {
    const uncertain = {key: 'uncertain', attempts: 3, dispatchedAt: Date.now()}

    assert.equal(isDispatchUncertain(uncertain), true)
    assert.equal(findNextRetryableDelivery([uncertain]), undefined)
    assert.equal(isExhaustedDelivery(uncertain), false)
    assert.deepEqual(findExhaustedDeliveries([uncertain]), [])
    assert.equal(countBlockingDeliveries([uncertain]), 1)
})

test('a late server ACK promotes an uncertain dispatch to acknowledged state', () => {
    const acknowledged = {
        key: 'late-ack', attempts: 0, dispatchedAt: Date.now(), serverMid: 'server-99',
    }

    assert.equal(isDispatchUncertain(acknowledged), false)
    assert.equal(isAwaitingDeliveryReceipt(acknowledged), true)
    assert.equal(countBlockingDeliveries([acknowledged]), 0)
})

test('a queued item that has never been dispatched remains retryable', () => {
    const queued = {key: 'queued', attempts: 2}

    assert.equal(isDispatchUncertain(queued), false)
    assert.equal(findNextRetryableDelivery([queued]), queued)
    assert.equal(isExhaustedDelivery(queued), false)
})

test('an old unknown dispatch becomes non-blocking manual review without becoming retryable', () => {
    const uncertain = {key: 'uncertain', attempts: 0, dispatchedAt: 1_000}
    assert.equal(shouldMoveUncertainToManualReview(uncertain, 120_999, 120_000), false)
    assert.equal(shouldMoveUncertainToManualReview(uncertain, 121_000, 120_000), true)

    const manualReview = {...uncertain, manualReviewAt: 121_000}
    assert.equal(isDispatchUncertain(manualReview), false)
    assert.equal(isManualReviewDelivery(manualReview), true)
    assert.equal(findNextRetryableDelivery([manualReview]), undefined)
    assert.equal(isExhaustedDelivery(manualReview), false)
    assert.equal(countBlockingDeliveries([manualReview]), 0)
})

test('manual review blocks only its conversation while another conversation can proceed', () => {
    const queue = [
        {key: 'unknown', conversationKey: 'conversation-a', dispatchedAt: 1_000, manualReviewAt: 121_000},
        {key: 'same-conversation', conversationKey: 'conversation-a', attempts: 0},
        {key: 'independent', conversationKey: 'conversation-b', attempts: 0},
    ]

    assert.equal(findNextRetryableOutsideUnknownScopes(queue)?.key, 'independent')
})

test('an uncertain dispatch blocks only its conversation while another greeting can proceed', () => {
    const queue = [
        {key: 'uncertain', conversationKey: 'conversation-a', dispatchedAt: Date.now()},
        {key: 'same-conversation', conversationKey: 'conversation-a', attempts: 0},
        {key: 'independent', conversationKey: 'conversation-b', attempts: 0},
    ]

    assert.equal(findNextRetryableOutsideUnknownScopes(queue)?.key, 'independent')
})

test('exact ungreeted DOM evidence unlocks an old uncertain greeting but not a fresh one', () => {
    const uncertain = {key: 'greeting', dispatchedAt: 1_000, clientMid: 'client-1'}

    assert.equal(canRetryAfterConfirmedUngreeted(uncertain, 30_999, 30_000), false)
    assert.equal(canRetryAfterConfirmedUngreeted(uncertain, 31_000, 30_000), true)
})

test('an acknowledged greeting is never unlocked by stale DOM text', () => {
    const acknowledged = {
        key: 'greeting', dispatchedAt: 1_000, clientMid: 'client-1', serverMid: 'server-1',
    }

    assert.equal(canRetryAfterConfirmedUngreeted(acknowledged, 120_000, 30_000), false)
})

test('delivery scope stays stable across rotating BOSS security ids', () => {
    assert.equal(deliveryScopeKey({
        key: 'greeting:stable-recruiter',
        conversationKey: 'stable-recruiter:rotating-security-a',
    }), 'greeting:stable-recruiter')
    assert.equal(deliveryScopeKey({
        key: '42:inbound-a',
        bossId: 42,
        conversationKey: 'stable-recruiter:rotating-security-b',
    }), 'boss:42')
})

test('DOM recovery waits for an active reply but can retry after terminal exhaustion', () => {
    const active = {
        key: '7:original-mid', bossId: 7, inboundMessageId: 'original-mid',
        inboundTextKey: 'same-text', attempts: 2,
    }
    const exhausted = {...active, attempts: 3}

    assert.equal(findActiveReplyForInbound([active], 7, 'dom:recovered-mid', 'same-text'), active)
    assert.equal(findActiveReplyForInbound([exhausted], 7, 'dom:recovered-mid', 'same-text'), undefined)
    assert.equal(findActiveReplyForInbound(
        [exhausted], 7, 'dom:recovered-mid', 'same-text', Number.POSITIVE_INFINITY,
    ), exhausted)
})

test('same-key work is serialized and a rejection does not poison its successor', async () => {
    const executor = new KeyedSerialExecutor()
    const events = []
    let releaseFirst
    let signalFirstStarted
    const firstGate = new Promise(resolve => {
        releaseFirst = resolve
    })
    const firstStarted = new Promise(resolve => {
        signalFirstStarted = resolve
    })

    const first = executor.run('conversation-1', async () => {
        events.push('first:start')
        signalFirstStarted()
        await firstGate
        events.push('first:end')
        throw new Error('expected')
    })
    const second = executor.run('conversation-1', async () => {
        events.push('second:start')
        return 'sent'
    })

    await firstStarted
    assert.deepEqual(events, ['first:start'])
    releaseFirst()
    await assert.rejects(first, /expected/)
    assert.equal(await second, 'sent')
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start'])
})

test('delivery gate has a bounded wait instead of freezing a run forever', () => {
    assert.equal(hasDeliveryGateTimedOut(1_000, 120_999, 120_000), false)
    assert.equal(hasDeliveryGateTimedOut(1_000, 121_000, 120_000), true)
})
