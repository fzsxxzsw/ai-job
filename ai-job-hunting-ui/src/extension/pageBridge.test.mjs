import assert from 'node:assert/strict'
import test from 'node:test'

import {
    BACKGROUND_CHANNEL,
    BRIDGE_PROTOCOL_VERSION,
    ISOLATED_WORLD_SOURCE,
    MAIN_WORLD_SOURCE,
} from './bridgeProtocol.ts'
import {installPageBridge} from './pageBridge.ts'

class FakePageWindow {
    location = {origin: 'https://www.zhipin.com'}
    listeners = new Set()
    posted = []

    addEventListener(type, listener) {
        if (type === 'message') this.listeners.add(listener)
    }

    removeEventListener(type, listener) {
        if (type === 'message') this.listeners.delete(listener)
    }

    postMessage(message, targetOrigin) {
        this.posted.push({message, targetOrigin})
    }

    dispatch(data, overrides = {}) {
        const event = {source: this, origin: this.location.origin, data, ...overrides}
        this.listeners.forEach(listener => listener(event))
    }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('isolated bridge forwards only validated operations and preserves request ids', async () => {
    const page = new FakePageWindow()
    const forwarded = []
    const remove = installPageBridge(page, {
        async sendMessage(message) {
            forwarded.push(message)
            return {
                channel: BACKGROUND_CHANNEL,
                protocol: BRIDGE_PROTOCOL_VERSION,
                requestId: message.requestId,
                ok: true,
                operation: 'notification-response',
                payload: {notificationId: 'notice-1'},
            }
        },
    })
    const request = {
        protocol: BRIDGE_PROTOCOL_VERSION,
        source: MAIN_WORLD_SOURCE,
        target: ISOLATED_WORLD_SOURCE,
        requestId: 'notice-request',
        operation: 'notification',
        payload: {title: 'AI工作猎手', text: '完成', silent: true, timeout: 1_000},
    }
    page.dispatch(request)
    page.dispatch({...request, requestId: 'bad', operation: 'arbitrary-browser-proxy'})
    page.dispatch(request, {origin: 'https://evil.example'})
    await flush()

    assert.equal(forwarded.length, 1)
    assert.equal(forwarded[0].operation, 'notification')
    assert.equal(page.posted.length, 1)
    assert.equal(page.posted[0].message.requestId, 'notice-request')
    assert.equal(page.posted[0].targetOrigin, 'https://www.zhipin.com')
    remove()
})
