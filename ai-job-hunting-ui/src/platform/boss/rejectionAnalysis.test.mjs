import assert from 'node:assert/strict'
import test from 'node:test'

import {
    APPLICATION_SNAPSHOT_REQUEST_CONFIG,
    appendRejectionMessage,
    buildRejectionAnalyzePayload,
    clearRejectionMessageBuffers,
    collectVisibleRejectionMessages,
    readRejectionMessages,
    readConversationRejectionMessages,
    saveApplicationSnapshotWithRetry,
    shouldApplyAnalysisResult,
    shouldShowRejectionSummary,
} from './rejectionAnalysis.ts'

test('keeps at most twelve in-memory messages per peer and dedupes mid/cmid aliases', () => {
    clearRejectionMessageBuffers()
    for (let index = 0; index < 14; index++) {
        appendRejectionMessage('boss-1', {
            role: index % 2 ? 'USER' : 'HR',
            text: `message-${index}`,
            mid: `mid-${index}`,
            cmid: `cmid-${index}`,
            timestamp: index + 1,
        })
    }
    appendRejectionMessage('boss-1', {
        role: 'USER',
        text: 'duplicate echo',
        mid: 'server-mid-13',
        cmid: 'cmid-13',
        timestamp: 100,
    })

    const messages = readRejectionMessages('boss-1')
    assert.equal(messages.length, 12)
    assert.equal(messages[0].text, 'message-2')
    assert.equal(messages.at(-1).messageId, 'server-mid-13')
    assert.equal(readRejectionMessages('boss-2').length, 0)
})

test('conversation-scoped messages do not mix with another job from the same recruiter', () => {
    clearRejectionMessageBuffers()
    appendRejectionMessage('recruiter-7', {role: 'HR', text: 'old job message', mid: 'old-1'})
    appendRejectionMessage('boss-encrypted:security-new', {role: 'HR', text: 'current rejection', mid: 'new-1'})

    assert.deepEqual(
        readConversationRejectionMessages('boss-encrypted:security-new', 'recruiter-7').map(item => item.text),
        ['current rejection'],
    )
    assert.deepEqual(
        readConversationRejectionMessages('missing-conversation', 'recruiter-7').map(item => item.text),
        [],
    )
    assert.deepEqual(readConversationRejectionMessages('', 'recruiter-7').map(item => item.text), ['old job message'])
})

test('buffer preparation does not touch storage or network before explicit API use', () => {
    clearRejectionMessageBuffers()
    let networkCalls = 0
    const originalFetch = globalThis.fetch
    const originalLocalStorage = globalThis.localStorage
    globalThis.fetch = async () => {
        networkCalls += 1
        throw new Error('unexpected network access')
    }
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: new Proxy({}, {get() { throw new Error('unexpected persistence access') }}),
    })
    try {
        appendRejectionMessage(7, {role: 'HR', text: '岗位周期暂时不匹配', mid: '1'})
        const payload = buildRejectionAnalyzePayload({
            encryptJobId: 'job-7',
            conversationKey: 'boss:security',
            bufferedMessages: readRejectionMessages(7),
        })
        assert.equal(payload.messages.length, 1)
        assert.equal(networkCalls, 0)
    } finally {
        globalThis.fetch = originalFetch
        if (originalLocalStorage === undefined) delete globalThis.localStorage
        else Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: originalLocalStorage})
    }
})

test('visible DOM fallback excludes helper controls and always builds an incomplete payload', () => {
    const fakeMessage = (className, text, attributes = {}) => ({
        className,
        textContent: text,
        parentElement: null,
        getAttribute(name) { return attributes[name] || null },
        closest() { return null },
        cloneNode() {
            return {
                textContent: text,
                querySelectorAll() { return [] },
            }
        },
    })
    const conversation = {
        querySelectorAll() {
            return [
                fakeMessage('message-item item-friend', '岗位周期暂时不匹配', {'data-mid': 'd-1'}),
                fakeMessage('message-item item-myself', '谢谢告知', {'data-cmid': 'u-1'}),
                fakeMessage('message-item item-myself', '已读'),
            ]
        },
    }
    const root = {
        querySelector(selector) {
            return selector === '.chat-conversation' ? conversation : null
        },
    }
    const visibleMessages = collectVisibleRejectionMessages(root)
    const payload = buildRejectionAnalyzePayload({
        encryptJobId: 'job-1',
        conversationKey: 'conversation-1',
        bufferedMessages: [],
        visibleMessages,
    })

    assert.deepEqual(visibleMessages.map(item => item.role), ['HR', 'USER'])
    assert.equal(payload.completeness, 'POSSIBLY_INCOMPLETE')
})

test('slow analysis results only apply to the conversation that started the request', () => {
    assert.equal(shouldApplyAnalysisResult('conversation-a', 'conversation-a'), true)
    assert.equal(shouldApplyAnalysisResult('conversation-a', 'conversation-b'), false)
    assert.equal(shouldApplyAnalysisResult('', ''), false)
})

test('older visible history cannot displace the newest buffered messages', () => {
    const visibleMessages = Array.from({length: 12}, (_, index) => ({
        role: 'HR',
        text: `old-${index}`,
        messageId: `old-${index}`,
    }))
    const bufferedMessages = Array.from({length: 4}, (_, index) => ({
        role: 'HR',
        text: `new-${index}`,
        messageId: `new-${index}`,
    }))

    const payload = buildRejectionAnalyzePayload({
        encryptJobId: 'job-window',
        conversationKey: 'conversation-window',
        bufferedMessages,
        visibleMessages,
    })

    assert.equal(payload.messages.length, 12)
    assert.deepEqual(payload.messages.slice(-4).map(item => item.text), [
        'new-0',
        'new-1',
        'new-2',
        'new-3',
    ])
})

test('snapshot persistence stays non-blocking when the optional backend route is unavailable', () => {
    assert.equal(APPLICATION_SNAPSHOT_REQUEST_CONFIG.timeout, 5000)
    assert.equal(APPLICATION_SNAPSHOT_REQUEST_CONFIG.suppressGlobalErrorToast, true)
})

test('snapshot save retries transient failures and resolves the idempotent success', async () => {
    let attempts = 0
    const delays = []
    const result = await saveApplicationSnapshotWithRetry({
        encryptJobId: 'job-retry',
        appliedAt: 1,
        jobBaseInfo: '{}',
        jobExtInfo: '{"jd":"backend"}',
        preMatchResult: {},
    }, {
        retryDelaysMs: [10, 20],
        save: async payload => {
            attempts += 1
            if (attempts < 3) throw new Error('transient')
            return {id: 9, encryptJobId: payload.encryptJobId, appliedAt: payload.appliedAt}
        },
        sleep: async delay => { delays.push(delay) },
    })

    assert.equal(attempts, 3)
    assert.deepEqual(delays, [10, 20])
    assert.equal(result.id, 9)
})

test('trend remains hidden until five confirmed or corrected cases', () => {
    assert.equal(shouldShowRejectionSummary({visible: true, totalConfirmed: 4, categoryCounts: {LEVEL: 4}}), false)
    assert.equal(shouldShowRejectionSummary({visible: false, totalConfirmed: 8, categoryCounts: {LEVEL: 8}}), false)
    assert.equal(shouldShowRejectionSummary({visible: true, totalConfirmed: 5, categoryCounts: {LEVEL: 5}}), true)
})
