import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {createAcknowledgedDispatchGate} from './geekChatTransport.ts'

function sourceFile(name) {
    return ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
}

function messageWith(dependencies) {
    const source = sourceFile('protobuf.ts')
    const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'Message')
    const send = klass.members.find(node => node.name?.getText(source) === 'send')
    const compiled = ts.transpileModule(`class TestMessage {${send.getText(source)}}; TestMessage`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    return new (runInNewContext(compiled, dependencies))()
}

function dispatchWith(dependencies) {
    const source = sourceFile('hookMain.ts')
    let dispatch
    const visit = node => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'dispatchChatMessage') dispatch = node
        if (!dispatch) ts.forEachChild(node, visit)
    }
    visit(source)
    const compiled = ts.transpileModule(`(${dispatch.getText(source)})`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    return runInNewContext(compiled, dependencies)
}

function bridgeSendWith(dependencies) {
    const source = sourceFile('hookMain.ts')
    let send
    const visit = node => {
        if (ts.isBinaryExpression(node) && node.left.getText(source).endsWith('.AIJobHelperChatBridge')
            && ts.isObjectLiteralExpression(node.right)) {
            send = node.right.properties.find(property => property.name?.getText(source) === 'send')
        }
        if (!send) ts.forEachChild(node, visit)
    }
    visit(source)
    const compiled = ts.transpileModule(`({${send.getText(source)}}).send`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    return runInNewContext(compiled, dependencies)
}

test('Message.send stops after an asynchronous readiness check without retrying or writing', async () => {
    let finishReadiness, writes = 0, retries = 0, authorized = true
    const bridge = {
        supportsDispatchAuthorization: true,
        isReady: () => false,
        ensureReady: () => new Promise(resolve => { finishReadiness = resolve }),
        send: () => { writes++; return true },
    }
    const message = messageWith({Tools: {window: {AIJobHelperChatBridge: bridge}, sleep: () => { retries++ }}, logRecorder: {warn() {}, error() {}}})
    const pending = message.send(3, 1, () => authorized)
    authorized = false
    finishReadiness(true)
    assert.equal(await pending, false)
    assert.equal(writes, 0)
    assert.equal(retries, 0)
})

test('Message.send keeps the ordinary AI reply call and a dispatched ACK intact', async () => {
    let writes = 0, authorized = true, finishAck
    const bridge = {
        supportsDispatchAuthorization: true,
        isReady: () => true,
        send: () => { writes++; return new Promise(resolve => { finishAck = resolve }) },
    }
    const message = messageWith({Tools: {window: {AIJobHelperChatBridge: bridge}}, logRecorder: {warn() {}, error() {}}})
    const pending = message.send(1, 0, () => authorized)
    authorized = false
    finishAck(true)
    assert.equal(await pending, true)
    assert.equal(writes, 1)
    bridge.send = () => { writes++; return true }
    assert.equal(await message.send(1), true)
    assert.equal(writes, 2)
})

test('Message.send refuses a guarded send through an older bridge without final-write checks', async () => {
    let writes = 0
    const message = messageWith({
        Tools: {window: {AIJobHelperChatBridge: {isReady: () => true, send: () => { writes++; return true }}}},
        logRecorder: {warn() {}, error() {}},
    })
    assert.equal(await message.send(1, 0, () => true), false)
    assert.equal(writes, 0)
})

test('native socket fallback cannot write after SDK readiness yields to a stop', async () => {
    let finishSdk, socketWrites = 0, authorized = true
    const dispatch = dispatchWith({
        geekChatTransport: {isReady: () => true, send: () => new Promise(resolve => { finishSdk = resolve })},
        getOpenChatSocket: () => ({send: () => { socketWrites++}}),
        mqtt: {encode: value => value}, outgoingMessageId: 0, Uint8Array,
    })
    const message = {msg: new Uint8Array([1]), msgObj: {}}
    const pending = dispatch(message, () => authorized)
    authorized = false
    finishSdk(false)
    assert.equal(await pending, false)
    assert.equal(socketWrites, 0)

    const withoutCallback = dispatch(message)
    finishSdk(false)
    assert.equal(await withoutCallback, true)
    assert.equal(socketWrites, 1)
})

test('bridge removes its ACK waiter when a stopped run cancels before dispatch', async () => {
    let finishDispatch, authorized = true
    const pendingMessageAcks = new Map()
    const bridgeSend = bridgeSendWith({
        Uint8Array, window: {setTimeout, clearTimeout},
        normalizeProtocolId: value => String(value || ''),
        rememberAutomatedClientMid() {}, findRecentMessageAck: () => undefined,
        createAcknowledgedDispatchGate, pendingMessageAcks,
        clearClientMidAliases() {},
        dispatchChatMessage: () => new Promise(resolve => { finishDispatch = resolve }),
        logRecorder: {error() {}},
    })
    const message = {msg: new Uint8Array([1]), msgObj: {cmid: '70000000000016'}}
    const pending = bridgeSend(message, () => authorized)
    assert.equal(pendingMessageAcks.size, 1)
    authorized = false
    finishDispatch(false)
    assert.equal(await pending, false)
    assert.equal(pendingMessageAcks.size, 0)
    assert.equal(message.msgObj.__dispatchedAt, undefined)
})
