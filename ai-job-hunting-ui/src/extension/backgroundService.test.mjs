import assert from 'node:assert/strict'
import test from 'node:test'

import {createBackgroundService} from './backgroundService.ts'
import {
    BACKGROUND_CHANNEL,
    base64ToArrayBuffer,
    BRIDGE_PROTOCOL_VERSION,
    DELIVERY_AUDIT_URL,
    normalizeGmPrivilegedRequest,
    RESUME_DOWNLOAD_URL,
} from './bridgeProtocol.ts'

const sender = (tabId, documentId = `document-${tabId}`) => ({
    url: 'https://www.zhipin.com/web/geek/job',
    tab: {id: tabId, url: 'https://www.zhipin.com/web/geek/job'},
    documentId,
    frameId: 0,
})

const request = (requestId, privileged) => ({
    channel: BACKGROUND_CHANNEL,
    protocol: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ...privileged,
})

const auditReport = {
    auditId: 'greeting:job-1',
    deliveryKey: 'job-1',
    kind: 'greeting',
    status: 'acknowledged',
    jobTitle: 'Java 工程师',
    contentHash: '24:abcd',
    contentLength: 24,
    attempts: 1,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_100,
}

function makeService(overrides = {}) {
    return createBackgroundService({
        fetch: async () => new Response('{}', {status: 200}),
        createNotification: async () => 'notification-1',
        clearNotification: async () => true,
        setTimer: (callback, delay) => setTimeout(callback, delay),
        clearTimer: handle => clearTimeout(handle),
        ...overrides,
    })
}

test('named resume and audit operations build only their fixed requests and preserve arraybuffer bytes', async () => {
    const calls = []
    const sourceBytes = Uint8Array.from([0, 1, 127, 128, 254, 255])
    const service = makeService({
        fetch: async (url, init) => {
            calls.push({url, init})
            if (url.startsWith(RESUME_DOWNLOAD_URL)) {
                return new Response(sourceBytes, {status: 200, headers: {'Content-Type': 'application/pdf'}})
            }
            return new Response('{"accepted":true}', {status: 202, headers: {'Content-Type': 'application/json'}})
        },
    })
    const resume = normalizeGmPrivilegedRequest({
        method: 'GET',
        url: `${RESUME_DOWNLOAD_URL}?resumeId=resume-123`,
        headers: {Zp_token: 'boss-session'},
        responseType: 'arraybuffer',
    })
    const resumeResponse = await service.handleMessage(request('resume-1', resume), sender(1))
    assert.equal(resumeResponse.ok, true)
    assert.equal(resumeResponse.operation, 'http-response')
    assert.deepEqual(
        [...new Uint8Array(base64ToArrayBuffer(resumeResponse.payload.body))],
        [...sourceBytes],
    )
    assert.equal(calls[0].url, `${RESUME_DOWNLOAD_URL}?resumeId=resume-123`)
    assert.equal(calls[0].init.method, 'GET')
    assert.deepEqual(calls[0].init.headers, {Zp_token: 'boss-session'})

    const audit = normalizeGmPrivilegedRequest({
        method: 'POST',
        url: DELIVERY_AUDIT_URL,
        headers: {Authorization: 'session-token', 'Content-Type': 'application/json; charset=utf-8'},
        data: JSON.stringify(auditReport),
        timeout: 5_000,
    })
    const auditResponse = await service.handleMessage(request('audit-1', audit), sender(1))
    assert.equal(auditResponse.ok, true)
    assert.equal(calls[1].url, DELIVERY_AUDIT_URL)
    assert.equal(calls[1].init.method, 'POST')
    assert.deepEqual(calls[1].init.headers, {
        Authorization: 'session-token',
        'Content-Type': 'application/json; charset=utf-8',
    })
    assert.deepEqual(JSON.parse(calls[1].init.body), auditReport)
    service.dispose()
})

test('same request id in two tabs is isolated and abort only affects its exact owner', async () => {
    const calls = []
    const service = makeService({
        fetch: (url, init) => new Promise((resolve, reject) => {
            const call = {url, init, resolve, reject}
            calls.push(call)
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true})
        }),
    })
    const privileged = normalizeGmPrivilegedRequest({
        method: 'GET',
        url: `${RESUME_DOWNLOAD_URL}?resumeId=resume-123`,
        headers: {Zp_token: 'boss-session'},
        responseType: 'arraybuffer',
    })
    const first = service.handleMessage(request('shared-id', privileged), sender(1))
    const second = service.handleMessage(request('shared-id', privileged), sender(2))
    assert.equal(calls.length, 2)

    await service.handleMessage(request('shared-id', {operation: 'request.abort', payload: {}}), sender(1))
    assert.equal(calls[0].init.signal.aborted, true)
    assert.equal(calls[1].init.signal.aborted, false)
    calls[1].resolve(new Response(Uint8Array.from([7, 8, 9]), {status: 200}))
    const [firstResponse, secondResponse] = await Promise.all([first, second])
    assert.equal(firstResponse.ok, false)
    assert.equal(firstResponse.error.kind, 'abort')
    assert.equal(secondResponse.ok, true)
    service.dispose()
})

test('notification timeout clears a notification at most once even when close/click events repeat', async () => {
    const timers = []
    const cleared = []
    const service = makeService({
        clearNotification: async notificationId => {
            cleared.push(notificationId)
            return true
        },
        setTimer: callback => {
            const handle = {callback, cleared: false}
            timers.push(handle)
            return handle
        },
        clearTimer: handle => {
            handle.cleared = true
        },
    })
    const response = await service.handleMessage(request('notice-1', {
        operation: 'notification',
        payload: {title: 'AI工作猎手', text: '完成', silent: true, timeout: 1_000},
    }), sender(1))
    assert.equal(response.ok, true)
    assert.equal(timers.length, 1)
    timers[0].callback()
    await Promise.resolve()
    timers[0].callback()
    service.handleNotificationClosed('notification-1')
    service.handleNotificationClicked('notification-1')
    await Promise.resolve()
    assert.deepEqual(cleared, ['notification-1'])
    assert.equal(timers[0].cleared, true)
    service.dispose()
})
