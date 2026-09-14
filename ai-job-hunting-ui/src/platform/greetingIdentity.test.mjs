import assert from 'node:assert/strict'
import test from 'node:test'

import {greetingLockIdentity, makeGreetingTaskKey, migrateAndDedupeGreetingTasks, reserveNewGreetingTask} from './greetingIdentity.ts'
import {makeDeliveryLockName} from './deliveryLock.ts'

test('builds a stable greeting key without the rotating securityId', () => {
    assert.equal(makeGreetingTaskKey(' boss-token '), 'greeting:boss-token')
})

test('migrates rotating securityId entries into one recruiter task', () => {
    const queue = migrateAndDedupeGreetingTasks([
        {
            key: 'boss-token:security-old',
            toName: 'boss-token',
            bossLookup: {encryptBossId: 'boss-token'},
            clientMid: '1',
            createdAt: 10,
        },
        {
            key: 'boss-token:security-new',
            toName: 'boss-token',
            bossLookup: {encryptBossId: 'boss-token'},
            clientMid: '2',
            createdAt: 20,
        },
    ])
    assert.equal(queue.length, 1)
    assert.equal(queue[0].key, 'greeting:boss-token')
    assert.equal(queue[0].clientMid, '2')
})

test('preserves an acknowledged task instead of replacing it with a newer retry', () => {
    const queue = migrateAndDedupeGreetingTasks([
        {toName: 'boss-token', clientMid: '1', serverMid: '9', createdAt: 10},
        {toName: 'boss-token', clientMid: '2', createdAt: 20},
    ])
    assert.equal(queue.length, 1)
    assert.equal(queue[0].serverMid, '9')
})

test('a new run cannot replace a same-recruiter UNKNOWN, ACKed, or manually stopped greeting', () => {
    const key = makeGreetingTaskKey('boss-token')
    const incoming = {key, runId: 'new-run', clientMid: 'new-mid', createdAt: 20}
    const prior = [
        {key, runId: 'old-run', clientMid: 'old-mid', dispatchedAt: 10, createdAt: 1},
        {key, runId: 'old-run', clientMid: 'old-mid', serverMid: 'server-mid', createdAt: 1},
        {key, runId: 'old-run', clientMid: 'old-mid', userStoppedAt: 10, createdAt: 1},
    ]
    for (const existing of prior) {
        const queue = [existing]
        const result = reserveNewGreetingTask(queue, incoming)
        assert.equal(result.reserved, false)
        assert.equal(result.queue, queue, 'the original delivery evidence stays intact')
        assert.equal(result.queue[0].clientMid, 'old-mid')
    }
    assert.deepEqual(reserveNewGreetingTask([], incoming), {queue: [incoming], reserved: true})
})

test('greeting reservation, worker, and manual retirement share a lock after boss ID arrives', () => {
    const key = makeGreetingTaskKey('boss-token')
    const queued = {key}
    const resolved = {key, toUid: '81'}
    assert.equal(makeDeliveryLockName('greeting', greetingLockIdentity(queued)),
        makeDeliveryLockName('greeting', greetingLockIdentity(resolved)))
    assert.notEqual(makeDeliveryLockName('greeting', greetingLockIdentity(resolved)),
        makeDeliveryLockName('ai-reply-recipient', '81'), 'AI replies retain their separate lock namespace')
})
