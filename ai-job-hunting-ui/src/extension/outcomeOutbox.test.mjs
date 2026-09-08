import assert from 'node:assert/strict'
import test from 'node:test'
import {createOutcomeOutbox, OUTCOME_OUTBOX_KEY, MAX_OUTCOME_EVENTS} from './outcomeOutbox.ts'
import {normalizeOutcomeObservation, normalizeOutcomeCommand, OUTCOME_API_URL, outcomeLabel, outcomePhaseLabel, outcomeTaskLabel} from './outcomesProtocol.ts'
import {produceSyntheticOutcomeScenario} from '../../scripts/outcome-synthetic-fixtures.mjs'

const now = 1788757200000
const messageId = '90071992547409932'
function observation(id = 'event-1') {
    return {eventId: id, encryptJobId: 'CaseSensitiveJob', conversationKey: 'Peer:Security', bossId: '81',
        source: 'BOSS_PASSIVE_MESSAGE', observedAt: now, bindingObservedAt: now - 100,
        messages: [{messageId, clientMessageId: null, role: 'HR', text: '明天下午面试', sentAt: null, deliveryState: 'UNKNOWN'}],
        readEvidence: null, coverage: null}
}
function memory() {
    const values = new Map()
    return {values, get: async key => structuredClone(values.get(key)), set: async (key, value) => { values.set(key, structuredClone(value)) }}
}
const session = (authorization = 'private-token', platformAccount = '42', serverUrl = OUTCOME_API_URL) => ({kind: 'session', authorization, platformAccount, serverUrl})
function setup() {
    const durable = memory(), credentials = memory(), calls = []
    let mode = 'success'
    let clock = now
    const fetch = async (url, init) => {
        calls.push({url, init})
        if (mode === 'network') throw new Error('offline')
        if (mode === '401') return new Response(JSON.stringify({code: 401, data: null}), {status: 401})
        if (mode === '422') return new Response(JSON.stringify({code: 422, data: null}), {status: 422})
        const data = init.method === 'POST' ? {acceptedEventIds: JSON.parse(init.body).observations.map(o => o.eventId), duplicateEventIds: []}
            : {items: [], total: 0}
        return new Response(JSON.stringify({code: 200, data}), {status: 200})
    }
    const deps = {durable, credentials, fetch, now: () => clock}
    return {durable, credentials, calls, deps, create: () => createOutcomeOutbox(deps), mode: value => { mode = value }, advance: ms => { clock += ms }}
}

test('observation contract preserves large opaque IDs, rejects identity injection, unknown fields and false coverage', () => {
    assert.equal(normalizeOutcomeObservation(observation()).messages[0].messageId, messageId)
    assert.equal(normalizeOutcomeObservation({...observation(), userId: '3'}), null)
    assert.equal(normalizeOutcomeObservation({...observation(), bossId: 81}), null)
    assert.equal(normalizeOutcomeObservation({...observation(), coverage: {anchorMessageId: messageId, latestMessageId: messageId, checkedAt: now, completeAfterAnchor: true}}), null)
    assert.equal(normalizeOutcomeCommand({kind: 'status', scope: 'a', url: 'https://evil.test'}), null)
    assert.equal(normalizeOutcomeObservation({...observation(), source: 'APPLICATION_FLOW', bossId: null, conversationKey: null, messages: []})?.source, 'APPLICATION_FLOW')
})

test('durable outbox survives restart, never stores token with facts, retries identical first observation and deduplicates repeated stream', async () => {
    const rig = setup()
    let box = rig.create()
    const first = await box.handle(session(), 'page-1')
    await box.handle({kind: 'enqueue', scope: first.scope, observations: [observation()]}, 'page-1')
    assert.equal(JSON.stringify([...rig.durable.values]).includes('private-token'), false)
    rig.mode('network')
    await box.tick()
    const original = rig.durable.values.get(OUTCOME_OUTBOX_KEY).entries[0].observation
    box = rig.create()
    await box.handle(session(), 'page-1')
    await box.handle({kind: 'enqueue', scope: first.scope, observations: [{...observation(), observedAt: now + 99, bindingObservedAt: now}]}, 'page-1')
    assert.deepEqual(rig.durable.values.get(OUTCOME_OUTBOX_KEY).entries[0].observation, original)
    rig.mode('success'); rig.advance(60_000)
    await box.tick()
    const posts = rig.calls.filter(call => call.init.method === 'POST')
    assert.deepEqual(JSON.parse(posts[0].init.body), JSON.parse(posts.at(-1).init.body))
    await box.handle({kind: 'enqueue', scope: first.scope, observations: [{...observation(), observedAt: now + 500}]}, 'page-1')
    assert.equal((await box.handle({kind: 'status', scope: first.scope}, 'page-1')).pending, 0)
    assert.equal(JSON.stringify(rig.durable.values.get(OUTCOME_OUTBOX_KEY).seen).includes('明天下午面试'), false)
})

test('login/platform account/server switches cannot replay queued facts under the new token or expose previous reports', async () => {
    const rig = setup(), box = rig.create()
    const old = await box.handle(session(), 'page-1')
    await box.handle({kind: 'enqueue', scope: old.scope, observations: [observation()]}, 'page-1')
    const current = await box.handle(session('other-token', '43'), 'page-1')
    assert.notEqual(old.scope, current.scope)
    await assert.rejects(box.handle({kind: 'status', scope: old.scope}, 'page-1'), /SESSION_CHANGED/)
    await box.tick()
    assert.equal(rig.calls.filter(call => call.init.method === 'POST').length, 0)
    assert.equal((await box.handle(session('other-token', '43', 'https://example.test'), 'page-1')).scope, '')
    await box.tick()
    assert.equal(rig.calls.every(call => call.url.startsWith(`${OUTCOME_API_URL}/api/job/outcomes/`)), true)
})

test('401 pauses retry until a different credential and 422 preserves blocked observations', async () => {
    const rig = setup(), box = rig.create()
    const {scope} = await box.handle(session(), 'page-1')
    await box.handle({kind: 'enqueue', scope, observations: [observation()]}, 'page-1')
    rig.mode('401'); await box.tick()
    const before = rig.calls.length
    assert.equal((await box.handle(session(), 'page-1')).scope, '')
    await box.tick()
    assert.equal(rig.calls.length, before)
    assert.equal(rig.durable.values.get(OUTCOME_OUTBOX_KEY).entries.length, 1)
    const second = await box.handle(session('new-token'), 'page-1')
    await box.handle({kind: 'enqueue', scope: second.scope, observations: [observation('e2')]}, 'page-1')
    rig.mode('422'); await box.tick()
    assert.equal((await box.handle({kind: 'status', scope: second.scope}, 'page-1')).blocked, 1)
})

test('outbox limit rejects excess observations without losing the existing queue', async () => {
    const rig = setup(), box = rig.create()
    const {scope} = await box.handle(session(), 'page')
    for (let index = 0; index < MAX_OUTCOME_EVENTS; index += 32) {
        await box.handle({kind: 'enqueue', scope, observations: Array.from({length: 32}, (_, offset) => observation(`e-${index + offset}`))}, 'page')
    }
    await assert.rejects(box.handle({kind: 'enqueue', scope, observations: [observation('overflow')]}, 'page'), /OUTBOX_FULL/)
    assert.equal(rig.durable.values.get(OUTCOME_OUTBOX_KEY).entries.length, MAX_OUTCOME_EVENTS)
})

test('all requested result classes and real graph waiting/failed/retry phases are distinguished', () => {
    assert.equal(outcomeLabel({outcome: 'REJECTED', readState: 'UNKNOWN'}), 'HR 已拒绝')
    assert.equal(outcomeLabel({outcome: 'POSITIVE', readState: 'READ'}), '积极回应')
    assert.equal(outcomeLabel({outcome: 'NO_REPLY', readState: 'READ'}), '已读不回')
    assert.equal(outcomeLabel({outcome: 'NO_REPLY', readState: 'UNREAD'}), '未读不回')
    assert.equal(outcomePhaseLabel('WAITING_CONFIRMATION'), '旧任务正在自动收尾')
    assert.equal(outcomePhaseLabel('RETRY'), '等待重试')
    assert.equal(outcomePhaseLabel('FAILED'), '处理失败')
    assert.equal(outcomeTaskLabel({status: 'READY', phase: 'COLLECTING'}), '等待 LangGraph 领取')
    assert.equal(outcomeTaskLabel({status: 'RUNNING', phase: 'SAVED'}), '报告已保存')
    assert.equal(outcomeTaskLabel({status: 'CONFIRMATION_READY', phase: 'WAITING_CONFIRMATION'}), '反馈已保存，正在收尾')
})

test('read evidence is submitted only after its exact ACK is accepted; restored outbox returns durable same-scope anchors', async () => {
    const rig = setup(), observations = produceSyntheticOutcomeScenario({now, hrText: ''})
    let box = rig.create()
    const {scope} = await box.handle(session(), 'page')
    for (const value of observations) assert.ok(normalizeOutcomeObservation(value))
    await box.handle({kind: 'enqueue', scope, observations: [...observations].reverse()}, 'page')
    await box.tick()
    const posts = rig.calls.filter(call => call.init.method === 'POST').map(call => JSON.parse(call.init.body).observations[0])
    assert.ok(posts.findIndex(value => value.source === 'BOSS_SEND_ACK') < posts.findIndex(value => value.source === 'BOSS_EXACT_MESSAGE_STATUS'))
    assert.deepEqual(posts.find(value => value.source === 'BOSS_EXACT_MESSAGE_STATUS').messages, [])
    box = rig.create()
    const restored = await box.handle(session(), 'new-document')
    assert.equal(restored.anchors.length, 1)
    assert.equal(restored.anchors[0].serverMid, messageId)
    assert.equal(restored.anchors[0].message.deliveryState, 'ACKNOWLEDGED')
    assert.equal((await box.handle(session('other-owner'), 'new-document')).anchors.length, 0)
})

test('one 422 observation cannot block valid neighbors; a read with no accepted ACK stays pending without being sent', async () => {
    const rig = setup(), originalFetch = rig.deps.fetch
    rig.deps.fetch = async (url, init) => {
        if (init.method === 'POST') {
            const event = JSON.parse(init.body).observations[0]
            if (event.messages.some(message => message.text === 'BUSINESS_BINDING_REJECT')) return new Response(JSON.stringify({code: 422, data: null}), {status: 422})
        }
        return originalFetch(url, init)
    }
    const box = rig.create(), {scope} = await box.handle(session(), 'page')
    const [,,read] = produceSyntheticOutcomeScenario({now, hrText: ''})
    const bad = observation('bad-business-association'); bad.messages[0].text = 'BUSINESS_BINDING_REJECT'
    await box.handle({kind: 'enqueue', scope, observations: [read, bad, observation('valid-neighbor')]}, 'page')
    const status = await box.tick()
    assert.equal(status.blocked, 1)
    assert.equal(status.pending, 1)
    assert.equal(rig.calls.filter(call => call.init.method === 'POST').length, 1)
    assert.equal(JSON.parse(rig.calls.find(call => call.init.method === 'POST').init.body).observations[0].messages[0].role, 'HR')
})

test('same authenticated owner with a rotated token gets distinct transport event IDs without duplicate material messages', async () => {
    const rig = setup(), wire = [], receipts = new Map(), material = new Set()
    rig.deps.fetch = async (_url, init) => {
        if (init.method !== 'POST') return new Response(JSON.stringify({code: 200, data: {items: [], total: 0}}))
        const events = JSON.parse(init.body).observations
        for (const value of events) {
            const previous = receipts.get(value.eventId)
            if (previous && previous !== JSON.stringify(value)) return new Response(JSON.stringify({code: 409, data: null}), {status: 409})
            receipts.set(value.eventId, JSON.stringify(value))
            for (const message of value.messages) material.add(`${value.encryptJobId}:${message.messageId}`)
            wire.push(value)
        }
        return new Response(JSON.stringify({code: 200, data: {acceptedEventIds: events.map(value => value.eventId), duplicateEventIds: []}}))
    }
    const box = rig.create()
    const first = await box.handle(session('owner-token-1'), 'page')
    await box.handle({kind: 'enqueue', scope: first.scope, observations: [observation('same-fact')]}, 'page')
    await box.tick()
    const second = await box.handle(session('owner-token-2'), 'page')
    const neighbor = observation('neighbor'); neighbor.messages[0].messageId = '90071992547409934'
    await box.handle({kind: 'enqueue', scope: second.scope, observations: [{...observation('same-fact'), observedAt: now + 1000}, neighbor]}, 'page')
    const result = await box.tick()
    assert.notEqual(wire[0].eventId, wire[1].eventId)
    assert.equal(material.size, 2)
    assert.equal(result.blocked, 0)
    assert.equal(result.pending, 0)
})
