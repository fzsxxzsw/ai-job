import assert from 'node:assert/strict'
import test from 'node:test'

import {
    buildGeekChatRecipient,
    createAcknowledgedDispatchGate,
    GeekChatTransport,
    normalizeGeekChatMessage,
    normalizeGeekChatStatus,
} from './geekChatTransport.ts'

class FakeSdk {
    constructor(status = 'CONNECTED') {
        this.status = status
        this.listeners = new Map()
        this.sent = []
        this.read = []
        this.socketConnect = this
    }

    on(event, listener) {
        const listeners = this.listeners.get(event) || new Set()
        listeners.add(listener)
        this.listeners.set(event, listeners)
    }

    off(event, listener) {
        this.listeners.get(event)?.delete(listener)
    }

    emit(event, payload) {
        for (const listener of this.listeners.get(event) || []) listener(payload)
    }

    getStatus() {
        return this.status
    }

    sendMessage(user, content, type) {
        this.sent.push({user, content, type})
        return {messages: [{cmid: user.clientMid, mid: user.clientMid}]}
    }

    sendRead(user, mid) {
        this.read.push({user, mid})
    }
}

function createWindow(sdk) {
    return {GeekChatCore: {getInstance: () => sdk}}
}

function createMessage(clientMid = '70000000000001') {
    return {
        msgObj: {
            cmid: clientMid,
            mid: clientMid,
            to: {uid: 42, source: 0, name: 'encrypted-user'},
            body: {type: 1, text: '你好'},
        },
    }
}

test('does not mark a pending dispatch as durable when ACK times out first', async () => {
    const msgObj = {__dispatchStartedAt: 1, __dispatchedAt: 2}
    const gate = createAcknowledgedDispatchGate(msgObj, 100)
    let settled
    void gate.promise.then(value => {
        settled = value
    })

    gate.acknowledgementTimedOut()
    await Promise.resolve()
    assert.equal(settled, undefined)
    assert.equal(msgObj.__dispatchState, 'pending')
    assert.equal(msgObj.__dispatchAttemptedAt, 100)
    assert.equal(msgObj.__dispatchStartedAt, undefined)
    assert.equal(msgObj.__dispatchedAt, undefined)

    gate.settleDispatch(true, 200)
    assert.equal(await gate.promise, false)
    assert.equal(msgObj.__dispatchState, 'accepted')
    assert.equal(msgObj.__dispatchedAt, 200)
})

test('keeps a rejected dispatch retryable after ACK timeout', async () => {
    const msgObj = {}
    const gate = createAcknowledgedDispatchGate(msgObj, 300)
    gate.acknowledgementTimedOut()
    gate.settleDispatch(false, 400)

    assert.equal(await gate.promise, false)
    assert.equal(msgObj.__dispatchState, 'rejected')
    assert.equal(msgObj.__dispatchedAt, undefined)
})

test('normalizes the SharedWorker SDK connected state', () => {
    assert.equal(normalizeGeekChatStatus({socketStatus: 'connected'}), 'CONNECTED')
    assert.equal(normalizeGeekChatStatus('reconnecting'), 'RECONNECTING')
    assert.equal(normalizeGeekChatStatus('disconnected'), 'DISCONNECTED')
    assert.equal(normalizeGeekChatStatus(0), 'CONNECTING')
    assert.equal(normalizeGeekChatStatus(1), 'CONNECTED')
    assert.equal(normalizeGeekChatStatus(3), 'DISCONNECTED')
})

test('reads the root SDK status when socketConnect exists but has no status yet', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.socketConnect = {client: undefined}
    const transport = new GeekChatTransport(createWindow(sdk))
    assert.equal(await transport.ensureReady(20, 1), true)
    assert.equal(transport.getDiagnostics().status, 'CONNECTED')
})

test('reports sanitized capability diagnostics for an uninitialized connector', async () => {
    const sdk = new FakeSdk(undefined)
    sdk.status = undefined
    sdk.socketConnect = {}
    const transport = new GeekChatTransport(createWindow(sdk))
    assert.equal(await transport.ensureReady(2, 1), false)
    const diagnostics = transport.getDiagnostics()
    assert.equal(diagnostics.coreAvailable, true)
    assert.equal(diagnostics.sdkAvailable, true)
    assert.equal(diagnostics.status, 'UNKNOWN')
    assert.match(diagnostics.summary, /Core:存在/)
})

test('treats GeekChatCore as ready without a window WebSocket', async () => {
    const sdk = new FakeSdk('CONNECTED')
    let readyEvents = 0
    const transport = new GeekChatTransport(createWindow(sdk), {
        onReady: () => readyEvents++,
    })
    assert.equal(await transport.ensureReady(20, 1), true)
    assert.equal(await transport.refreshReady(), true)
    assert.equal(transport.isReady(), true)
    assert.equal(readyEvents, 1)
})

test('keeps the persisted clientMid when sending through GeekChatCore', async () => {
    const sdk = new FakeSdk('CONNECTED')
    const transport = new GeekChatTransport(createWindow(sdk))
    const message = createMessage('70000000000009')
    assert.deepEqual(buildGeekChatRecipient(message), {
        uid: 42,
        friendSource: 0,
        source: 0,
        encryptUid: 'encrypted-user',
        clientMid: '70000000000009',
    })
    assert.equal(await transport.send(message), true)
    assert.equal(sdk.sent.length, 1)
    assert.equal(sdk.sent[0].user.clientMid, '70000000000009')
    assert.equal(sdk.sent[0].type, 'text')
})

test('prefers the SDK root facade over a connected socketConnect with no client', async () => {
    const sdk = new FakeSdk('CONNECTED')
    const brokenConnector = {
        status: 'CONNECTED',
        sendMessage() {
            throw new TypeError("Cannot read properties of undefined (reading 'client')")
        },
    }
    sdk.socketConnect = brokenConnector
    const transport = new GeekChatTransport(createWindow(sdk))

    assert.equal(await transport.send(createMessage('70000000000011')), true)
    assert.equal(sdk.sent.length, 1)
})

test('adopts the actual clientMid generated by the high-level SDK', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function (user, content) {
        this.emit('message', [{
            cmid: '90000000000077',
            mid: '90000000000077',
            fromId: 7,
            toId: user.uid,
            bodyType: 1,
            text: content,
        }])
        return null
    }
    const assignments = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
    })
    const message = createMessage('70000000000012')

    assert.equal(await transport.send(message), true)
    assert.equal(message.msgObj.cmid, '90000000000077')
    assert.deepEqual(assignments, [{
        original: '70000000000012',
        actual: '90000000000077',
    }])
})

test('adopts a clientMessageId from a nested single-object send result', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function (user, content) {
        return {
            data: {
                result: {
                    payload: {
                        clientMessageId: '90000000000078',
                        toId: user.uid,
                        bodyType: 1,
                        text: content,
                    },
                },
            },
        }
    }
    const assignments = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
    })
    const message = createMessage('70000000000013')

    assert.equal(await transport.send(message), true)
    assert.equal(message.msgObj.cmid, '90000000000078')
    assert.deepEqual(assignments, [{
        original: '70000000000013',
        actual: '90000000000078',
    }])
})

test('forwards an ACK identity returned directly by the high-level SDK', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function () {
        return {
            data: {
                clientMessageId: '90000000000079',
                messageId: '99000000000079',
            },
        }
    }
    const assignments = []
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
        onProtocol: protocol => protocols.push(protocol),
    })
    const message = createMessage('70000000000014')

    assert.equal(await transport.send(message), true)
    assert.equal(message.msgObj.cmid, '90000000000079')
    assert.deepEqual(assignments, [{
        original: '70000000000014',
        actual: '90000000000079',
    }])
    assert.deepEqual(protocols, [{
        type: 5,
        messageSync: [{
            clientMid: '90000000000079',
            serverMid: '99000000000079',
        }],
    }])
})

test('does not treat a local mid equal to cmid as an ACK result', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function (user) {
        return {clientMessageId: user.clientMid, messageId: user.clientMid}
    }
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })

    assert.equal(await transport.send(createMessage('70000000000015')), true)
    assert.deepEqual(protocols, [])
})

test('removes a pending high-level correlation when the SDK throws', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function () {
        throw new Error('send rejected')
    }
    const assignments = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
    })

    assert.equal(await transport.send(createMessage('70000000000016')), false)
    sdk.emit('message', [{
        cmid: '90000000000080',
        fromId: 7,
        toId: 42,
        bodyType: 1,
        text: '你好',
    }])
    assert.deepEqual(assignments, [])
})

test('removes a pending high-level correlation on an explicit failed result', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function () {
        return {success: false}
    }
    const assignments = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
    })

    assert.equal(await transport.send(createMessage('70000000000017')), false)
    sdk.emit('message', [{
        cmid: '90000000000081',
        fromId: 7,
        toId: 42,
        bodyType: 1,
        text: '你好',
    }])
    assert.deepEqual(assignments, [])
})

test('retains a successful high-level send until its later echo arrives', async () => {
    const sdk = new FakeSdk('CONNECTED')
    sdk.sendTextMessage = function () {
        return null
    }
    const assignments = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onClientMidAssigned: (original, actual) => assignments.push({original, actual}),
    })
    const message = createMessage('70000000000018')

    assert.equal(await transport.send(message), true)
    sdk.emit('message', [{
        cmid: '90000000000082',
        fromId: 7,
        toId: 42,
        bodyType: 1,
        text: '你好',
    }])
    assert.equal(message.msgObj.cmid, '90000000000082')
    assert.deepEqual(assignments, [{
        original: '70000000000018',
        actual: '90000000000082',
    }])
})

test('prefers the original raw client path for GeekChatCore 1.x', async () => {
    const sdk = new FakeSdk('CONNECTED')
    const rawMessages = []
    sdk.getClient = () => ({
        client: {
            send(message) {
                rawMessages.push(message)
            },
        },
    })
    const transport = new GeekChatTransport(createWindow(sdk))
    const message = {...createMessage('70000000000010'), msg: new Uint8Array([1, 2, 3])}

    assert.equal(await transport.send(message), true)
    assert.deepEqual(rawMessages, [message])
    assert.equal(sdk.sent.length, 0)
})

test('normalizes GeekChatCore 1.x flattened messages', () => {
    assert.deepEqual(normalizeGeekChatMessage({
        mid: '9001',
        cmid: '0',
        fromId: 42,
        fromSource: 0,
        fromName: 'HR',
        fromAvatar: 'avatar.png',
        toId: 7,
        toSource: 0,
        bodyType: 1,
        templateId: 1,
        text: '你好',
    }), {
        mid: '9001',
        cmid: '0',
        fromId: 42,
        fromSource: 0,
        fromName: 'HR',
        fromAvatar: 'avatar.png',
        toId: 7,
        toSource: 0,
        bodyType: 1,
        templateId: 1,
        text: '你好',
        from: {uid: 42, source: 0, name: 'HR', avatar: 'avatar.png'},
        to: {uid: 7, source: 0},
        body: {type: 1, templateId: 1, text: '你好', image: undefined, action: undefined},
    })
})

test('forwards GeekChatCore 1.x message events as raw-shaped protocols', () => {
    const sdk = new FakeSdk('CONNECTED')
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()
    sdk.emit('message', [{mid: '9002', fromId: 42, toId: 7, bodyType: 1, text: '在吗'}])
    assert.equal(protocols.length, 1)
    assert.equal(protocols[0].messages[0].from.uid, 42)
    assert.equal(protocols[0].messages[0].body.text, '在吗')
})

test('normalizes flattened GeekChatCore 1.x delivery events before forwarding', () => {
    const sdk = new FakeSdk('CONNECTED')
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()
    sdk.emit('messageDelivered', [{mid: '9003', cmid: '8003', fromId: 7, toId: 42, bodyType: 1, text: '收到'}])
    assert.equal(protocols[0].messages[0].from.uid, 7)
    assert.equal(protocols[0].messages[0].to.uid, 42)
    assert.equal(protocols[0].messages[0].cmid, '8003')
})

test('forwards messageSync and inbound messages exactly once after repeated binding', () => {
    const sdk = new FakeSdk('CONNECTED')
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()
    transport.bindAvailableSdk()
    sdk.emit('messageSync', [{clientMid: '7', serverMid: '8'}])
    sdk.emit('messageArrived', [{mid: '9', body: {text: 'HR消息'}}])
    assert.equal(protocols.length, 2)
    assert.deepEqual(protocols[0].messageSync, [{clientMid: '7', serverMid: '8'}])
    assert.equal(protocols[1].messages[0].mid, '9')
})

test('listens on a distinct socketConnect and suppresses only synchronous relays', async () => {
    const sdk = new FakeSdk('CONNECTED')
    const connector = new FakeSdk('CONNECTED')
    sdk.socketConnect = connector
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()

    const payload = {data: {messageSync: [{clientMid: '71', serverMid: '81'}]}}
    connector.emit('messageSync', payload)
    sdk.emit('messageSync', payload)
    assert.equal(protocols.length, 1)
    assert.deepEqual(protocols[0].messageSync, [{clientMid: '71', serverMid: '81'}])

    await Promise.resolve()
    connector.emit('messageSync', payload)
    assert.equal(protocols.length, 2)
})

test('rebinds protocol listeners when socketConnect is replaced', () => {
    const sdk = new FakeSdk('CONNECTED')
    const firstConnector = new FakeSdk('CONNECTED')
    const secondConnector = new FakeSdk('CONNECTED')
    sdk.socketConnect = firstConnector
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()
    firstConnector.emit('messageSync', [{clientMid: '72', serverMid: '82'}])
    assert.equal(protocols.length, 1)

    sdk.socketConnect = secondConnector
    transport.bindAvailableSdk()
    firstConnector.emit('messageSync', [{clientMid: '73', serverMid: '83'}])
    assert.equal(protocols.length, 1)
    secondConnector.emit('messageSync', [{clientMid: '74', serverMid: '84'}])
    assert.equal(protocols.length, 2)
})

test('accepts SDK versions that emit a complete protocol object', () => {
    const sdk = new FakeSdk('CONNECTED')
    const protocols = []
    const transport = new GeekChatTransport(createWindow(sdk), {
        onProtocol: protocol => protocols.push(protocol),
    })
    transport.bindAvailableSdk()
    sdk.emit('messageArrived', {type: 1, messages: [{mid: '10'}, {mid: '11'}]})
    assert.deepEqual(protocols, [{type: 1, messages: [{mid: '10'}, {mid: '11'}]}])
})

test('waits through connecting and becomes ready on the SDK status event', async () => {
    const sdk = new FakeSdk('CONNECTING')
    const transport = new GeekChatTransport(createWindow(sdk))
    setTimeout(() => {
        sdk.status = 'CONNECTED'
        sdk.emit('socketStatus', 'CONNECTED')
    }, 5)
    assert.equal(await transport.ensureReady(100, 2), true)
})

test('sends read receipts through the same SharedWorker SDK', async () => {
    const sdk = new FakeSdk('CONNECTED')
    const transport = new GeekChatTransport(createWindow(sdk))
    assert.equal(await transport.sendRead('42', '99'), true)
    assert.deepEqual(sdk.read, [{user: {uid: 42, friendSource: 0, source: 0}, mid: '99'}])
})
