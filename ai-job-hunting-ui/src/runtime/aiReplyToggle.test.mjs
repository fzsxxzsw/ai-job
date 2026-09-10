import assert from 'node:assert/strict'
import test from 'node:test'

import {applyAiReplyToggle} from './aiReplyToggle.ts'

test('disabling AI replies only saves the disabled seat state', async () => {
    const calls = []
    const response = await applyAiReplyToggle(false, {
        saveSeatStatus: async enabled => {
            calls.push(['seat', enabled])
            return {enabled}
        },
        setGlobalStop: async stopped => calls.push(['global-stop', stopped]),
    })

    assert.deepEqual(response, {enabled: false})
    assert.deepEqual(calls, [['seat', false]])
})

test('enabling AI replies saves the seat before clearing the global stop', async () => {
    const calls = []
    await applyAiReplyToggle(true, {
        saveSeatStatus: async enabled => {
            calls.push(['seat', enabled])
            return {enabled}
        },
        setGlobalStop: async stopped => calls.push(['global-stop', stopped]),
    })

    assert.deepEqual(calls, [
        ['seat', true],
        ['global-stop', false],
    ])
})

test('failed global resume compensates by disabling the seat and rejects', async () => {
    const calls = []
    const failure = new Error('resume failed')

    await assert.rejects(applyAiReplyToggle(true, {
        saveSeatStatus: async enabled => {
            calls.push(['seat', enabled])
            return {enabled}
        },
        setGlobalStop: async stopped => {
            calls.push(['global-stop', stopped])
            throw failure
        },
    }), failure)

    assert.deepEqual(calls, [
        ['seat', true],
        ['global-stop', false],
        ['seat', false],
    ])
})

test('the original global-resume error survives a failed compensation', async () => {
    const failure = new Error('resume failed')
    let saveCalls = 0

    await assert.rejects(applyAiReplyToggle(true, {
        saveSeatStatus: async () => {
            saveCalls++
            if (saveCalls > 1) throw new Error('rollback failed')
            return true
        },
        setGlobalStop: async () => {
            throw failure
        },
    }), failure)
})
