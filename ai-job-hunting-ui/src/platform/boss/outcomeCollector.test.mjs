import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createPassiveOutcomeCollector, exactDomReadEvidence, exactPlatformId, verifiedOutcomeCoverage} from './outcomeCollector.ts'
import {normalizeOutcomeObservation} from '../../extension/outcomesProtocol.ts'

const now = 1788757200000, own = '40', peer = '81', cmid = '90071992547409931', mid = '90071992547409932'
const friend = {uid: peer, encryptJobId: 'Job', encryptBossId: 'EncryptedPeer', securityId: 'Security'}
const binding = {bossId: peer, conversationKey: 'EncryptedPeer:Security', encryptJobId: 'Job', observedAt: now}
const outbound = {binding, clientMid: cmid, serverMid: mid, message: {messageId: mid, clientMessageId: cmid, role: 'USER', text: '你好', sentAt: now, deliveryState: 'ACKNOWLEDGED'}}
function dom({state = '已读', id = mid, client = cmid, role = 'item-myself', count = 1, bodyOnly = false} = {}) {
    const status = {textContent: state, closest: () => bodyOnly ? {} : null}
    const row = {className: role, getAttribute: key => ({'data-mid': id, 'data-cmid': client}[key] || null), closest: () => null, querySelectorAll: () => [status]}
    const conversation = {querySelectorAll: () => Array.from({length: count}, () => row)}
    return {querySelector: () => conversation}
}

test('passive incoming facts are bound before emission; own echo and exact ACK merge by strings without fabricating a timestamp', () => {
    const events = [], collector = createPassiveOutcomeCollector(value => events.push(value))
    collector.message({mid, from: {uid: peer}, to: {uid: own}}, '暂不合适', own, now)
    assert.equal(events.length, 0)
    collector.bind([friend], own, now)
    collector.message({mid: cmid, cmid, from: {uid: own}, to: {uid: peer}}, '你好', own, now + 1)
    assert.equal(events[0].messages[0].messageId, `client:${cmid}`)
    assert.equal(events[0].messages[0].sentAt, null)
    assert.equal(events[0].messages[0].deliveryState, 'UNKNOWN')
    collector.acknowledge(cmid, mid, now + 2)
    assert.equal(events[1].source, 'BOSS_SEND_ACK')
    assert.equal(events[1].messages[0].messageId, mid)
    assert.equal(events[1].messages[0].clientMessageId, cmid)
    assert.equal(events[1].messages[0].deliveryState, 'ACKNOWLEDGED')
    collector.acknowledge(cmid, mid, now + 100)
    assert.equal(events.length, 2)
    collector.message({mid: '90071992547409933', from: {uid: peer}, to: {uid: own}}, '明天面试', own, now + 3)
    assert.equal(events.at(-1).messages[0].role, 'HR')
    assert.equal(events.every(event => event.coverage === null), true)
    assert.equal(exactPlatformId(Number(mid)), '')
})

test('platform account changes, conflicting job binding, third-party recipients and stale bindings never mix conversations', () => {
    const events = [], collector = createPassiveOutcomeCollector(value => events.push(value))
    collector.bind([friend], own, now)
    const raw = {mid, from: {uid: peer}, to: {uid: own}}
    collector.message(raw, '内容', '41', now + 1)
    assert.equal(events.length, 0)
    collector.bind([friend], own, now)
    collector.message({...raw, encryptJobId: 'OtherJob'}, '内容', own, now + 1)
    collector.message({...raw, to: {uid: '99'}}, '内容', own, now + 1)
    collector.message(raw, '内容', own, now + 31 * 60_000)
    assert.equal(events.length, 0)
})

test('exact read collector accepts only the same conversation, own matching ID bubble, explicit status and unambiguous match', () => {
    const selected = {bossId: peer, conversationKey: binding.conversationKey}
    assert.equal(exactDomReadEvidence(dom(), outbound, selected, now).state, 'READ')
    assert.equal(exactDomReadEvidence(dom({state: '未读'}), outbound, selected, now).state, 'UNREAD')
    for (const root of [dom({state: '已送达'}), dom({id: 'other'}), dom({client: 'other'}), dom({role: 'item-friend'}), dom({count: 2}), dom({bodyOnly: true})]) {
        assert.equal(exactDomReadEvidence(root, outbound, selected, now), null)
    }
    assert.equal(exactDomReadEvidence(dom(), outbound, {...selected, conversationKey: 'other'}, now), null)
})

test('terminal proof supports exact latest==anchor or verified continuous tail, rejects mere heartbeat and wrong conversation', () => {
    const proof = {conversationKey: binding.conversationKey, bossId: peer, checkedAt: now + 24 * 60 * 60_000,
        latestMessageId: mid, terminalVerified: true, continuousAfterAnchor: false, messageIds: [mid]}
    assert.equal(verifiedOutcomeCoverage(outbound, proof).completeAfterAnchor, true)
    assert.equal(verifiedOutcomeCoverage(outbound, null), null)
    assert.equal(verifiedOutcomeCoverage(outbound, {...proof, terminalVerified: false}), null)
    assert.equal(verifiedOutcomeCoverage(outbound, {...proof, conversationKey: 'other'}), null)
    assert.equal(verifiedOutcomeCoverage(outbound, {...proof, latestMessageId: 'new', messageIds: [mid, 'new']}), null)
    assert.equal(verifiedOutcomeCoverage(outbound, {...proof, latestMessageId: 'new', messageIds: [mid, 'new'], continuousAfterAnchor: true}).latestMessageId, 'new')
})

test('conversation change cannot publish an old read/snapshot into the new case', () => {
    const events = [], collector = createPassiveOutcomeCollector(value => events.push(value))
    collector.bind([friend], own, now)
    collector.message({mid, cmid, from: {uid: own}, to: {uid: peer}, time: now}, '你好', own, now + 1)
    const count = events.length
    collector.inspectCurrent(dom(), {bossId: '82', conversationKey: 'Other'}, now + 2)
    assert.equal(events.length, count)
    collector.inspectCurrent(dom(), {bossId: peer, conversationKey: binding.conversationKey}, now + 3)
    assert.equal(events.at(-1).readEvidence.state, 'READ')
    assert.equal(events.at(-1).conversationKey, binding.conversationKey)
})

test('the manual analyze button is removed; automatic observer and report subscription mount without browser actions', () => {
    const bossUi = readFileSync(new URL('../../components/ui/BossMessage.vue', import.meta.url), 'utf8')
    assert.equal(bossUi.includes('分析这次拒绝'), false)
    assert.match(bossUi, /<OutcomeReports\/>/)
    const runtime = readFileSync(new URL('./outcomeRuntime.ts', import.meta.url), 'utf8')
    assert.match(runtime, /observer\.observe\(root\.body/)
    assert.doesNotMatch(runtime, /\.click\(|\.scrollTo\(|\.scrollIntoView\(|fetch\(/)
})

test('late binding replays only explicit same-job/conversation or exact panel message proof with first observed time intact', () => {
    const events = [], collector = createPassiveOutcomeCollector(value => events.push(value))
    const raw = {mid, from: {uid: peer}, to: {uid: own}}
    collector.message(raw, '很抱歉，暂不合适', own, now)
    assert.equal(collector.health().unbound, 1)
    collector.bind([friend], own, now + 100)
    assert.equal(events.length, 0)
    collector.bind([friend], own, now + 200, {...binding, messageIds: ['different']})
    assert.equal(events.length, 0)
    collector.bind([friend], own, now + 300, {...binding, messageIds: [mid]})
    assert.equal(events.length, 1)
    assert.equal(events[0].observedAt, now)
    assert.equal(events[0].bindingObservedAt, now + 300)
    assert.equal(events[0].messages[0].sentAt, null)
    assert.equal(collector.health().unbound, 0)
    const other = createPassiveOutcomeCollector(value => events.push(value))
    other.message({...raw, encryptJobId: 'Job', conversationKey: binding.conversationKey}, '邀请面试', own, now)
    other.bind([friend], own, now + 400)
    assert.equal(events.at(-1).observedAt, now)
    assert.equal(events.at(-1).bindingObservedAt, now + 400)
})

test('unresolved collection is bounded, reports real overflow, and clears on platform-account change', () => {
    const collector = createPassiveOutcomeCollector(() => undefined)
    for (let i = 1; i <= 129; i++) collector.message({mid: String(i), from: {uid: peer}, to: {uid: own}}, '待关联', own, now)
    assert.deepEqual(collector.health(), {unbound: 128, discarded: 1})
    collector.bind([friend], 'new-account-is-invalid', now + 1)
    assert.deepEqual(collector.health(), {unbound: 0, discarded: 0})
})

test('page restart restores accepted historical anchors, including server-ID-only snapshots; passive echoes never prove ACK', () => {
    const events = [], restarted = createPassiveOutcomeCollector(value => events.push(value))
    restarted.bind([friend], own, now)
    restarted.message({mid, from: {uid: own}, to: {uid: peer}}, '昨日发出的消息', own, now + 1)
    assert.equal(events[0].messages[0].deliveryState, 'UNKNOWN')
    restarted.inspectCurrent(dom({client: ''}), binding, now + 2)
    assert.equal(events.length, 1)
    restarted.restoreAcknowledged([{...outbound, clientMid: '', message: {...outbound.message, clientMessageId: null}, acceptedAt: now}], own)
    restarted.inspectCurrent(dom({client: ''}), binding, now + 3)
    const read = events.at(-1)
    assert.equal(read.source, 'BOSS_EXACT_MESSAGE_STATUS')
    assert.deepEqual(read.messages, [])
    assert.equal(read.readEvidence.messageId, mid)
    assert.ok(normalizeOutcomeObservation({...read, eventId: 'read-recovered'}))
    assert.equal(normalizeOutcomeObservation({...read, eventId: 'invalid-old-read', messages: [outbound.message]}), null)
})
