import assert from 'node:assert/strict'
import test from 'node:test'

import {
    awaitManualTakeoverReadyForInbound,
    bindManualTakeoverFence,
    classifyManualTakeoverInbound,
    clearManualTakeoverFence,
    confirmManualOutgoingEcho,
    consumeManualTakeoverAfterAcceptedInbound,
    dispatchManualTakeoverMode,
    manualFenceBlocks,
    markManualTakeoverActive,
    markManualTakeoverPermanent,
    markManualTakeoverSyncFailed,
    observeManualTakeoverInbound,
    readManualTakeoverFence,
    recordProvisionalManualOutgoing,
    synchronizeManualTakeoverFence,
    trackManualTakeoverActivation,
} from './manualTakeover.ts'

class MemoryStorage {
    values = new Map()
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
    setItem(key, value) { this.values.set(key, String(value)) }
    removeItem(key) { this.values.delete(key) }
}

const inbound = {
    account: '40',
    bossId: '81',
    mid: '9001',
    sentAt: 1_800_000_000_000,
    text: '请介绍一下相关经验',
    conversationKey: 'BossA:SecA',
    uncertain: false,
}

test('provisional manual fence stays fail-closed past a later reply action TTL', () => {
    const storage = new MemoryStorage()
    const clock = Date.now()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({
        account: '40', bossId: '81', clientMid: '9101', text: '我有三年相关经验',
        sentAt: inbound.sentAt + 100,
    }, storage, clock)
    assert.equal(manualFenceBlocks('40', '81', storage), true)
    const oldSendTextCreatedAt = clock + 60_000
    const afterOriginalTenMinuteWindow = clock + 10 * 60_000 + 1
    assert.ok(afterOriginalTenMinuteWindow < oldSendTextCreatedAt + 10 * 60_000,
        'the old SEND_TEXT is still inside its server-side action TTL')
    assert.equal(readManualTakeoverFence(
        '40', '81', storage, afterOriginalTenMinuteWindow)?.status, 'PROVISIONAL')
    assert.equal(readManualTakeoverFence(
        '40', '81', storage, oldSendTextCreatedAt + 10 * 60_000 + 1)?.status, 'PROVISIONAL')
    assert.equal(manualFenceBlocks('40', '81', storage), true)
})

test('a delayed own echo without its original provisional fence cannot bind a newer inbound', () => {
    const storage = new MemoryStorage()
    const clock = Date.now()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage, clock)

    clearManualTakeoverFence('40', '81', storage)
    const newer = {...inbound, mid: '9002', sentAt: inbound.sentAt + 1000, text: '后来的HR追问'}
    observeManualTakeoverInbound(newer, storage)

    assert.equal(confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101',
        serverMid: '9201', text: '人工回复', sentAt: inbound.sentAt + 200}, storage,
    clock + 10 * 60_000 + 1), undefined)
    assert.equal(readManualTakeoverFence('40', '81', storage), undefined)
    assert.equal(JSON.parse(storage.getItem(
        'ai-job-manual-takeover-v1:inbound:40:81')).mid, '9002')
})

test('only a distinct positive platform server MID confirms takeover', () => {
    const storage = new MemoryStorage()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage, 1000)
    assert.equal(confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101',
        serverMid: '9101', text: '人工回复', sentAt: inbound.sentAt + 200}, storage, 1100), undefined)
    assert.equal(confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101',
        serverMid: 'server-mid', text: '人工回复', sentAt: inbound.sentAt + 200}, storage, 1100), undefined)
    assert.equal(confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101',
        serverMid: '9201', text: '人工回复', sentAt: inbound.sentAt + 200}, storage, 1100)?.status, 'CONFIRMED')
})

test('restart binding fills only missing fields and rejects a conflicting conversation', () => {
    const storage = new MemoryStorage()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage)
    confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101', serverMid: '9201',
        text: '人工回复', sentAt: inbound.sentAt + 200}, storage)
    const binding = {conversationKey: 'BossA:SecA', encryptJobId: 'JobA', jobKey: 'JobA:40'}
    assert.deepEqual(bindManualTakeoverFence('40', '81', binding, storage),
        {...readManualTakeoverFence('40', '81', storage), ...binding})
    assert.equal(bindManualTakeoverFence('40', '81',
        {...binding, conversationKey: 'BossB:SecB'}, storage), undefined)
    assert.equal(readManualTakeoverFence('40', '81', storage)?.conversationKey, 'BossA:SecA')
})

test('legacy manual takeover stops the legacy session and never dispatches the unified path', async () => {
    let unifiedCalls = 0
    let legacyStops = 0
    const mode = await dispatchManualTakeoverMode(async () => false, {
        unified: async () => { unifiedCalls++ },
        legacy: async () => { legacyStops++ },
    })
    assert.equal(mode, 'LEGACY_STOPPED')
    assert.equal(legacyStops, 1)
    assert.equal(unifiedCalls, 0, 'manual reply cannot start a second unified reply in legacy mode')

    await assert.rejects(dispatchManualTakeoverMode(async () => { throw new Error('mode unknown') }, {
        unified: async () => { unifiedCalls++ },
        legacy: async () => { legacyStops++ },
    }))
    assert.equal(legacyStops, 1, 'unknown mode must not be treated as explicitly disabled')
    assert.equal(unifiedCalls, 0)
})

test('M1 stays blocked and only a strictly newer accepted M2 consumes an active fence', async () => {
    const storage = new MemoryStorage()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage)
    confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101', serverMid: '9201',
        text: '人工回复', sentAt: inbound.sentAt + 200}, storage)
    const activation = Promise.resolve().then(() => markManualTakeoverActive('40', '81', storage))
    trackManualTakeoverActivation('40', '81', activation)

    const current = await awaitManualTakeoverReadyForInbound(inbound, storage)
    assert.deepEqual(current, {allowed: false, candidate: false, reason: 'MANUAL_TAKEOVER_ACTIVE'})
    const newer = {...inbound, mid: '9002', sentAt: inbound.sentAt + 1000}
    const ready = await awaitManualTakeoverReadyForInbound(newer, storage)
    assert.deepEqual(ready, {allowed: true, candidate: true})
    assert.equal(consumeManualTakeoverAfterAcceptedInbound(newer, storage), true)
    assert.equal(manualFenceBlocks('40', '81', storage), false)
})

test('equal, missing, older, and permanent-paused watermarks fail closed', async () => {
    for (const sentAt of [inbound.sentAt, null, inbound.sentAt - 1]) {
        const storage = new MemoryStorage()
        observeManualTakeoverInbound(inbound, storage)
        recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
            text: '人工回复', sentAt: inbound.sentAt + 100}, storage)
        confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101', serverMid: '9201',
            text: '人工回复', sentAt: inbound.sentAt + 200}, storage)
        markManualTakeoverActive('40', '81', storage)
        const next = {...inbound, mid: '9002', sentAt}
        assert.equal(classifyManualTakeoverInbound(next, storage).relation, 'UNCERTAIN')
        assert.equal((await awaitManualTakeoverReadyForInbound(next, storage)).allowed, false)
    }
    const storage = new MemoryStorage()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage)
    markManualTakeoverPermanent('40', '81', storage)
    const result = await awaitManualTakeoverReadyForInbound(
        {...inbound, mid: '9002', sentAt: inbound.sentAt + 1000}, storage)
    assert.equal(result.allowed, false)
    assert.equal(result.reason, 'PERMANENT_PAUSED')
})

test('a confirmed SYNC_FAILED fence retries idempotently and never auto-clears', async () => {
    const storage = new MemoryStorage()
    observeManualTakeoverInbound(inbound, storage)
    recordProvisionalManualOutgoing({account: '40', bossId: '81', clientMid: '9101',
        text: '人工回复', sentAt: inbound.sentAt + 100}, storage)
    confirmManualOutgoingEcho({account: '40', bossId: '81', clientMid: '9101', serverMid: '9201',
        text: '人工回复', sentAt: inbound.sentAt + 200}, storage)
    const fence = readManualTakeoverFence('40', '81', storage)
    Object.assign(fence, {conversationKey: 'BossA:SecA', encryptJobId: 'JobA', jobKey: 'JobA:40'})
    storage.setItem('ai-job-manual-takeover-v1:fence:40:81', JSON.stringify(fence))
    markManualTakeoverSyncFailed('40', '81', 'NETWORK_ERROR', storage)

    let attempts = 0
    await assert.rejects(synchronizeManualTakeoverFence('40', '81', 'manual-request', async () => {
        attempts++
        throw new Error('offline')
    }, storage))
    assert.equal(readManualTakeoverFence('40', '81', storage)?.status, 'SYNC_FAILED')
    assert.equal(manualFenceBlocks('40', '81', storage), true)

    const result = await synchronizeManualTakeoverFence('40', '81', 'manual-request', async payload => {
        attempts++
        assert.equal(payload.manualOutboundMessageId, '9201')
        assert.equal(payload.requestId, 'manual-request')
        return {permanentPaused: false}
    }, storage)
    assert.equal(result.permanentPaused, false)
    assert.equal(attempts, 2)
    assert.equal(readManualTakeoverFence('40', '81', storage)?.status, 'ACTIVE')
})
