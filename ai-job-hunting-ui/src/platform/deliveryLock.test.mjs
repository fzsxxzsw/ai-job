import assert from 'node:assert/strict'
import test from 'node:test'

import {makeDeliveryLockName, runWithOptionalDeliveryLock} from './deliveryLock.ts'

function createLockManager() {
    const held = new Set()
    return {
        async request(name, _options, callback) {
            if (held.has(name)) return await callback(null)
            held.add(name)
            try {
                return await callback({name})
            } finally {
                held.delete(name)
            }
        },
    }
}

test('delivery lock safely falls back when Web Locks is unavailable', async () => {
    const execution = await runWithOptionalDeliveryLock(undefined, 'greeting', 'delivery-1', async () => 'sent')
    assert.deepEqual(execution, {acquired: true, value: 'sent'})
})

test('same delivery identity is cross-tab serialized while independent identities proceed', async () => {
    const lockManager = createLockManager()
    let releaseFirst
    let signalStarted
    const gate = new Promise(resolve => {
        releaseFirst = resolve
    })
    const started = new Promise(resolve => {
        signalStarted = resolve
    })

    const first = runWithOptionalDeliveryLock(lockManager, 'conversation', 'same', async () => {
        signalStarted()
        await gate
        return 'first'
    })
    await started

    let duplicateExecuted = false
    const duplicate = await runWithOptionalDeliveryLock(lockManager, 'conversation', 'same', async () => {
        duplicateExecuted = true
        return 'duplicate'
    })
    const independent = await runWithOptionalDeliveryLock(lockManager, 'conversation', 'other', async () => 'other')

    assert.deepEqual(duplicate, {acquired: false})
    assert.equal(duplicateExecuted, false)
    assert.deepEqual(independent, {acquired: true, value: 'other'})
    releaseFirst()
    assert.deepEqual(await first, {acquired: true, value: 'first'})
})

test('delivery lock names are stable without exposing the raw conversation identity', () => {
    const first = makeDeliveryLockName('conversation', 'sensitive-recruiter-id')
    const second = makeDeliveryLockName('conversation', 'sensitive-recruiter-id')

    assert.equal(first, second)
    assert.equal(first.includes('sensitive-recruiter-id'), false)
})

test('lock-manager failures fail closed without executing a side effect', async () => {
    let executed = false
    const execution = await runWithOptionalDeliveryLock({
        request: async () => {
            throw new Error('lock backend unavailable')
        },
    }, 'ai-reply', 'delivery-2', async () => {
        executed = true
    })

    assert.deepEqual(execution, {acquired: false})
    assert.equal(executed, false)
})

test('executor failures propagate instead of looking like lock contention', async () => {
    const lockManager = createLockManager()
    await assert.rejects(
        runWithOptionalDeliveryLock(lockManager, 'greeting', 'delivery-3', async () => {
            throw new Error('send failed')
        }),
        /send failed/,
    )
})
