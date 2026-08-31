import assert from 'node:assert/strict'
import test from 'node:test'

import {makeGreetingTaskKey, migrateAndDedupeGreetingTasks} from './greetingIdentity.ts'

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
