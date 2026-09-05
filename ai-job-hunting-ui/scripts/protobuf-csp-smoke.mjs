import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import Long from 'long'

const values = new Map()
const localStorage = {
    getItem(key) {
        return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
        values.set(key, String(value))
    },
    removeItem(key) {
        values.delete(key)
    },
}
const noop = () => {}
const fakeWindow = {
    localStorage,
    location: {origin: 'https://www.zhipin.com'},
    addEventListener: noop,
    removeEventListener: noop,
    postMessage: noop,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
}
globalThis.window = fakeWindow
globalThis.self = fakeWindow

const RealDate = Date
const fixedTime = 1760000000000
globalThis.Date = class FixedDate extends RealDate {
    constructor(...args) {
        super(...(args.length === 0 ? [fixedTime] : args))
    }

    static now() {
        return fixedTime
    }
}

const fixturePath = resolve(process.cwd(), 'fixtures', 'protobuf-wire-fixtures.json')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const fixturesByName = new Map(fixture.cases.map(entry => [entry.name, entry]))
const {Message, MessageRead, protobufType} = await import('../src/webSocket/protobuf.ts')

function toHex(bytes) {
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

for (const entry of fixture.cases) {
    const encoded = protobufType.encode(entry.value).finish()
    assert.equal(toHex(encoded), entry.expectedHex, `${entry.name} must keep the legacy reflection wire bytes`)
}

const outbound = fixturesByName.get('outbound-message')
const outboundMessage = new Message({
    form_uid: outbound.value.messages[0].from.uid,
    to_uid: outbound.value.messages[0].to.uid,
    to_name: outbound.value.messages[0].to.name,
    content: outbound.value.messages[0].body.text,
    image: undefined,
    clientMid: outbound.value.messages[0].cmid,
})
assert.equal(outboundMessage.hex, outbound.expectedHex, 'Message must keep its public encoding behavior')
assert.equal(toHex(new Uint8Array(outboundMessage.toArrayBuffer())), outbound.expectedHex)

const read = fixturesByName.get('message-read')
const readMessage = new MessageRead({
    userId: read.value.messageRead[0].userId,
    messageId: read.value.messageRead[0].messageId,
})
assert.equal(readMessage.hex, read.expectedHex, 'MessageRead must keep its public encoding behavior')
assert.equal(toHex(new Uint8Array(readMessage.toArrayBuffer())), read.expectedHex)

const inbound = fixturesByName.get('inbound-message')
const decoded = protobufType.decode(Uint8Array.from(Buffer.from(inbound.expectedHex, 'hex')))
assert.equal(Long.isLong(decoded.messages[0].from.uid), true, 'decoded int64 must remain a Long')
assert.equal(decoded.messages[0].from.uid.toString(), '9223372036854775806')
assert.equal(decoded.messages[0].mid.toString(), '9223372036854775805')
assert.equal(decoded.messages[0].to.uid.toString(), '9007199254740993')

console.log('Protobuf CSP smoke passed: Message, MessageRead, inbound decode, wire parity, and int64 precision.')
