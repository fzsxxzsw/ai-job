import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {checkConversationExclusion, matchEmploymentExclusion} from './employmentExclusions.ts'

const pref = {fhE: true, employmentExcludeE: true, employmentExcludeKeywords: ['外包', '劳务派遣', '驻场', '外派']}
const fixture = JSON.parse(readFileSync(new URL('../../../ai-job-api/tests/fixtures/employment-exclusions.json', import.meta.url), 'utf8'))

test('shared job / JD / conversation keyword cases include explicit negation and platform marks', () => {
    for (const row of fixture) assert.equal(matchEmploymentExclusion(pref, row.text), row.hit, JSON.stringify(row))
    assert.equal(matchEmploymentExclusion({}, '外包猎头'), null)
    assert.equal(matchEmploymentExclusion({...pref, employmentExcludeE: false}, '外包'), null)
    assert.equal(matchEmploymentExclusion({...pref, fhE: false}, {goldHunter: 1}), null)
})

function storage() {
    const values = new Map()
    return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}
}

test('conversation exclusions survive follow-up and reload, are isolated and reversible', () => {
    const saved = storage()
    assert.equal(checkConversationExclusion(saved, 'peer-A', pref, '我们是外包'), '外包')
    assert.equal(checkConversationExclusion(saved, 'peer-A', pref, '方便发简历吗'), '外包')
    assert.equal(checkConversationExclusion(saved, 'peer-B', pref, '方便发简历吗'), null)
    assert.equal(checkConversationExclusion(saved, 'peer-A', {...pref, employmentExcludeE: false}, '你好'), null)
    assert.equal(checkConversationExclusion(saved, 'peer-A', {...pref, employmentExcludeKeywords: ['劳务派遣']}, '你好'), null)
    assert.equal(checkConversationExclusion({getItem: () => '{', setItem: () => {throw Error()}}, 'peer', pref, '外包'), '外包')
})

// Execute the actual message/queue method bodies with inert dependencies. Never load BOSS or its network modules.
function handlers() {
    const path = new URL('./bossPlatform.ts', import.meta.url)
    const source = ts.createSourceFile('bossPlatform.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BossOption')
    const names = ['handleBossMessage', 'deliverPendingAiReplyLocked']
    const methods = klass.members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source))
    const code = ts.transpileModule(`class BossOption { ${methods.join('\n')} }; BossOption`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    const calls = {exchange: 0, ask: 0, send: 0, removed: [], audit: []}
    const memory = storage()
    const userStore = {user: {preference: pref, aiSeatStatus: 1}}
    const Type = runInNewContext(code, {
        userStore, localStorage: memory, getBossRiskStop: () => false,
        captureOutcomeContext: () => 'synthetic-scope', exactPlatformId: value => String(value || ''),
        unifiedAutomationEnabled: async () => false,
        checkConversationExclusion, stableDeliveryKey: (a,b) => a + b,
        logger: {info() {}, debug() {}}, logging: {trace() {}},
        Tools: {isHardBlockedCompany: () => false, window: {_PAGE: {uid: '40'}}},
        AiPower: {ask: () => {calls.ask++; throw Error('Must not call AI')}},
        isDispatchUncertain: () => false, isManualReviewDelivery: () => false,
        readDeliveryAudit: () => [], hasBossDeliveryReceipt: () => false,
        hasServerAcknowledgement: () => false,
        recordDeliveryAudit: row => calls.audit.push(row),
    })
    Type.inboundMessageProcessingKeys = new Set()
    Type.aiReplySendingKeys = new Set()
    Type.bossUserInfoMap = new Map()
    Type.latestLiveInbound = new Map()
    Type.logRecorder = {warn() {}, error() {}}
    Type.messageCache = {isMessageProcessed: () => false, markMessageAsProcessed() {}}
    const instance = new Type()
    instance.preHandlerMsgByMsgType = () => true
    instance.getBossUserInfoByBossId = async () => ({jobTitle: '研发岗位'})
    instance.preHandlerMsgByBodyType = () => {calls.exchange++; return false}
    instance.removeAiReplyFromQueue = key => calls.removed.push(key)
    instance.sendMsg = () => {calls.send++; throw Error('Must not send')}
    return {instance, calls, memory, userStore}
}

test('actual message guard blocks AI, system exchanges, later resume requests and pending sends', async () => {
    const {instance, calls} = handlers()
    const message = {messages: [{mid: '1', body: {type: 1}}]}
    await instance.handleBossMessage(message, 7, '我们是外包，方便发简历吗')
    await instance.handleBossMessage({messages: [{mid: '2', body: {type: 7}}]}, 7, '交换联系方式')
    await instance.deliverPendingAiReplyLocked({key: 'queued', bossId: 7, conversationKey: 'peer', jobTitle: '研发岗位', content: '你好'})
    assert.equal(calls.exchange, 0)
    assert.equal(calls.ask, 0)
    assert.equal(calls.send, 0)
    assert.deepEqual(calls.removed, ['queued'])
    assert.equal(calls.audit[0].status, 'blocked')
})

test('actual message guard permits explicit non-outsourced employers and honors a saved off switch', async () => {
    const {instance, calls, userStore} = handlers()
    await instance.handleBossMessage({messages: [{mid: '1', body: {type: 7}}]}, 7, '非外包，交换联系方式')
    userStore.user.preference = {...pref, employmentExcludeE: false}
    await instance.handleBossMessage({messages: [{mid: '2', body: {type: 7}}]}, 8, '外包')
    assert.equal(calls.exchange, 2)
})

test('actual job matcher blocks platform / title before details and JD before later matching', async () => {
    const source = ts.createSourceFile('platform.ts', readFileSync(new URL('./platform.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BossPlatform')
    const method = klass.members.find(node => node.name?.getText(source) === 'matchJob').getText(source)
    const code = ts.transpileModule(`class BossPlatform { ${method} }; BossPlatform`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText
    const Type = runInNewContext(code, {
        userStore: {user: {preference: pref}}, matchEmploymentExclusion,
        Tools: {isHardBlockedCompany: () => false},
        NotMatchException: class extends Error {constructor(title, hit, reason) {super(reason + ':' + hit)}},
    })
    let details = 0
    const instance = new Type()
    instance.getJobKey = () => 'fixture-job'
    instance.obtainBossJobDetailExt = async () => {details++; return {postDescription: '劳务派遣合同'}}
    await assert.rejects(instance.matchJob({brandName:'公司',jobName:'研发',goldHunter:1}), /平台猎头标记/)
    await assert.rejects(instance.matchJob({brandName:'公司',jobName:'外包研发'}), /外包/)
    assert.equal(details, 0)
    await assert.rejects(instance.matchJob({brandName:'公司',jobName:'研发'}), /劳务派遣/)
    assert.equal(details, 1)
})
