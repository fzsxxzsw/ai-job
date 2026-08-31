import assert from 'node:assert/strict'
import test from 'node:test'

import {
    customGreetingEnabled,
    GREETING_RETRY_INTERVAL_MS,
    greetingBlocksNewApplications,
    greetingRequiresReadyChannel,
    normalizeGreetingDeliveryMode,
} from './greetingPolicy.ts'

test('retries queued greetings on the requested fifteen-second cadence', () => {
    assert.equal(GREETING_RETRY_INTERVAL_MS, 15_000)
})

test('migrates an existing custom greeting to non-blocking background delivery', () => {
    assert.equal(normalizeGreetingDeliveryMode(undefined, true, '你好'), 'custom-queued')
})

test('defaults an unused or empty legacy greeting to the platform behavior', () => {
    assert.equal(normalizeGreetingDeliveryMode(undefined, false, ''), 'platform-default')
    assert.equal(normalizeGreetingDeliveryMode(undefined, true, '  '), 'platform-default')
})

test('only strict custom greetings require and block on the chat channel', () => {
    assert.equal(customGreetingEnabled('custom-queued'), true)
    assert.equal(greetingRequiresReadyChannel('custom-queued'), false)
    assert.equal(greetingBlocksNewApplications('custom-queued'), false)
    assert.equal(greetingRequiresReadyChannel('custom-required'), true)
    assert.equal(greetingBlocksNewApplications('custom-required'), true)
})
