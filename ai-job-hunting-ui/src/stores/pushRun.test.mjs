import assert from 'node:assert/strict'
import test from 'node:test'

import {runWithOptionalWebLock} from './pushRun.ts'

test('runs normally when Web Locks is unavailable', async () => {
    const execution = await runWithOptionalWebLock(undefined, async () => 'done')
    assert.deepEqual(execution, {acquired: true, value: 'done'})
})

test('returns acquired false without executing when another tab owns the lock', async () => {
    let called = false
    const lockManager = {
        request: async (_name, _options, callback) => callback(null),
    }
    const execution = await runWithOptionalWebLock(lockManager, async () => {
        called = true
        return 'unexpected'
    })
    assert.deepEqual(execution, {acquired: false})
    assert.equal(called, false)
})

test('holds the lock until the whole run executor completes', async () => {
    const events = []
    const lockManager = {
        request: async (name, options, callback) => {
            events.push(['request', name, options.ifAvailable])
            const result = await callback({name})
            events.push(['released'])
            return result
        },
    }
    const execution = await runWithOptionalWebLock(lockManager, async () => {
        events.push(['running'])
        return 'done'
    })
    assert.equal(execution.value, 'done')
    assert.deepEqual(events, [
        ['request', 'ai-job-hunting-boss-push-run-v1', true],
        ['running'],
        ['released'],
    ])
})
