import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {webcrypto} from 'node:crypto'
import ts from 'typescript'
import {hasMaterialDeliveryAuditChange} from './deliveryAuditState.ts'
import {hasServerAcknowledgement, isDispatchUncertain, isManualReviewDelivery} from './deliveryQueue.ts'

function receipts() {
    const source = ts.createSourceFile('boss.ts', readFileSync(new URL('./bossPlatform.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
    const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'BossOption')
    const names = ['reconcileLegacyAiReplyAck', 'pruneScopedLegacyAiReplyReceipts', 'drainAiReplyQueue', 'deliverPendingAiReplyLocked']
    const bodies = klass.members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source))
    let scope = 'owner-server-account-A', ack = {clientMid: '100', serverMid: '200'}, persisted = 0
    const audits = [], pageReceipts = [], entry = {key: '7:9', bossId: 7, conversationKey: 'boss:sec', clientMid: '100', dispatchedAt: 1, receiptScope: scope, content: 'hello', attempts: 1}
    let queue = [entry]
    const Type = runInNewContext(ts.transpileModule(`class BossOption {${bodies.join('\n')}}; BossOption`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText, {
        captureAutomationScope: () => scope, unifiedAutomationEnabled: async () => true,
        holdUnifiedAutomation() {}, hasServerAcknowledgement, isDispatchUncertain, isManualReviewDelivery,
        Tools: {window: {AIJobHelperChatBridge: {getAcknowledgement: mid => { assert.equal(mid, '100'); return ack }}}},
        recordDeliveryAudit: item => audits.push(item),
        readDeliveryAudit: () => pageReceipts,
    })
    const instance = new Type()
    instance.readAiReplyQueue = () => queue
    instance.writeAiReplyQueue = value => queue = value
    instance.persistAiReplyEntry = () => persisted++
    for (const name of ['finalizeInboundMessageAfterAck','pruneSettledAiReplyQueue','getBossUserInfoByBossId','sendMsg']) instance[name] = () => assert.fail(`unsafe ${name}`)
    return {instance, entry, audits, pageReceipts, queue: () => queue, persisted: () => persisted, scope: value => scope = value, ack: value => ack = value}
}

test('unified queue drain accepts exact local ACK without any platform or finalization call', async () => {
    const h = receipts()
    await h.instance.drainAiReplyQueue()
    assert.equal(h.entry.serverMid, '200')
    assert.equal(h.audits.length, 1)
    await h.instance.drainAiReplyQueue()
    assert.equal(h.persisted(), 1)
})

test('unowned, changed-account, mismatched, aliased and equal ACK ids remain uncertain', async () => {
    for (const change of [h => delete h.entry.receiptScope, h => h.scope('other'),
        h => h.ack({clientMid: '101', serverMid: '200'}), h => h.ack({clientMid: '100', serverMid: '100'}),
        h => h.ack({clientMid: '100', serverMid: 'bad'})]) {
        const h = receipts(); change(h)
        assert.equal(await h.instance.deliverPendingAiReplyLocked(h.entry), false)
        assert.equal(h.persisted(), 0)
    }
})

test('receipt-only pruning requires current ownership and every exact message identity', async () => {
    for (const mutate of [() => {}, h => delete h.entry.receiptScope, h => h.scope('other'),
        h => h.pageReceipts[0].serverMid = '201', h => h.pageReceipts[0].clientMid = '101',
        h => h.pageReceipts[0].conversationKey = 'other', h => h.pageReceipts[0].bossId = '8']) {
        const h = receipts()
        h.entry.serverMid = '200'
        h.pageReceipts.push({key: h.entry.key, kind: 'ai-reply', status: 'receipt', bossId: '7',
            conversationKey: 'boss:sec', clientMid: '100', serverMid: '200'})
        mutate(h)
        h.instance.pruneScopedLegacyAiReplyReceipts()
        assert.equal(h.queue().length, mutate.toString() === '() => {}' ? 0 : 1)
    }
})

function auditHarness(shared = new Map()) {
    const requests = [], exports = {}
    let now = 1_800_000_000_000
    const win = {_PAGE: {uid: '7'}}
    const localStorage = {getItem: key => shared.get(key) ?? null, setItem: (key, value) => shared.set(key, value)}
    if (!shared.has('Authorization')) shared.set('Authorization', 'synthetic-login-A')
    const source = readFileSync(new URL('./deliveryAudit.ts', import.meta.url), 'utf8')
    runInNewContext(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, {
        exports, require: name => name === '$' ? {
            GM_getValue: (key, fallback) => shared.get(key) ?? fallback,
            GM_setValue: (key, value) => shared.set(key, value),
            GM_xmlhttpRequest: request => requests.push(request),
        } : {hasMaterialDeliveryAuditChange},
        localStorage, window: win, URL, TextEncoder, crypto: webcrypto, Uint8Array,
        setTimeout, clearTimeout, Date: class extends Date {static now() { return now }},
    })
    return {api: exports, shared, requests, win, tick: () => now += 400_000,
        settle: async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2)) }}
}
const input = {key: 'new', kind: 'ai-reply', status: 'queued', content: 'private message'}

test('audit persists before request, retries after reload and stops after five failures', async () => {
    let h = auditHarness()
    h.api.recordDeliveryAudit(input); await h.settle()
    assert.equal(h.requests.length, 1)
    assert.equal(h.api.readDeliveryAudit()[0].upload.attempts, 1)
    assert.ok(!h.requests[0].data.includes('private message'))
    assert.ok(!h.shared.get('ai-job-delivery-audit-v1').includes('synthetic-login-A'))
    h.requests[0].onerror(); await h.settle()
    h = auditHarness(h.shared)
    for (let i = 0; i < 4; i++) {
        h.tick(); const pending = h.api.flushDeliveryAuditReports(); await h.settle()
        h.requests.at(-1).ontimeout(); await pending
    }
    h.tick(); await h.api.flushDeliveryAuditReports()
    assert.equal(h.requests.length, 4)
    assert.equal(h.api.readDeliveryAudit()[0].upload.attempts, 5)
})

test('audit requires explicit API success before suppressing retries', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input); await h.settle()
    h.requests[0].onload({status: 200, responseText: '{"code":500}'}); await h.settle()
    assert.equal(h.api.readDeliveryAudit()[0].upload.sentAt, undefined)
    h.tick(); const pending = h.api.flushDeliveryAuditReports(); await h.settle()
    h.requests.at(-1).onload({status: 200, responseText: '{"code":200,"data":{"id":1}}'}); await pending
    h.tick(); await h.api.flushDeliveryAuditReports()
    assert.equal(h.requests.length, 2)
})

test('same-millisecond material revision is not marked uploaded by an older response', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input); await h.settle()
    const initial = h.api.readDeliveryAudit()[0]
    // Do not advance the clock: a queued -> failed transition may share updatedAt.
    h.api.recordDeliveryAudit({...input, status: 'failed'}); await h.settle()
    const newer = h.api.readDeliveryAudit()[0]
    assert.equal(newer.updatedAt, initial.updatedAt)
    assert.equal(newer.status, 'failed')
    h.requests[0].onload({status: 200, responseText: '{"code":200,"data":{"id":1}}'})
    await h.settle()
    assert.equal(h.api.readDeliveryAudit()[0].upload.sentAt, undefined)
    const pending = h.api.flushDeliveryAuditReports(); await h.settle()
    assert.equal(h.requests.length, 2)
    assert.equal(JSON.parse(h.requests[1].data).status, 'failed')
    h.requests[1].onload({status: 200, responseText: '{"code":200,"data":{"id":1}}'})
    await pending
    assert.ok(h.api.readDeliveryAudit()[0].upload.sentAt)
})

test('synchronous initial transitions retain original ownership and upload latest state once', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input)
    h.api.recordDeliveryAudit({...input, status: 'failed'})
    await h.settle()
    assert.equal(h.requests.length, 1)
    assert.equal(JSON.parse(h.requests[0].data).status, 'failed')
    h.requests[0].onload({status: 200, responseText: '{"code":200,"data":{"id":1}}'})
    await h.settle()
    assert.ok(h.api.readDeliveryAudit()[0].upload.sentAt)
})

test('account change during first ownership hash cannot adopt the new unowned record', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input)
    h.shared.set('Authorization', 'different-login')
    h.api.recordDeliveryAudit({...input, status: 'failed'})
    await h.settle()
    assert.equal(h.requests.length, 0)
    assert.equal(h.api.readDeliveryAudit()[0].upload, undefined)
})

test('records added during retry ownership hash are not overwritten', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input); await h.settle()
    h.requests[0].onerror(); await h.settle(); h.tick()
    const pending = h.api.flushDeliveryAuditReports()
    h.api.recordDeliveryAudit({...input, key: 'another'})
    await h.settle()
    assert.equal(h.api.readDeliveryAudit().length, 2)
    h.requests[1].onerror(); await pending
    assert.equal(h.api.readDeliveryAudit().length, 2)
})

test('unowned historical audits and changed login/platform/server are never uploaded', async () => {
    const h = auditHarness()
    h.api.recordDeliveryAudit(input); await h.settle()
    h.requests[0].onerror(); await h.settle(); h.tick()
    for (const [key, value] of [['Authorization','other-login'], ['custom_server_url','http://localhost:9100/']]) {
        const old = h.shared.get(key); h.shared.set(key, value)
        await h.api.flushDeliveryAuditReports(); assert.equal(h.requests.length, 1)
        if (old === undefined) h.shared.delete(key); else h.shared.set(key, old)
    }
    h.win._PAGE.uid = '8'; await h.api.flushDeliveryAuditReports(); assert.equal(h.requests.length, 1)
    const old = h.api.readDeliveryAudit()[0]; delete old.upload
    h.shared.set('ai-job-delivery-audit-v1', JSON.stringify([old]))
    h.api.recordDeliveryAudit({...input, status: 'failed'}); await h.settle()
    assert.equal(h.requests.length, 1)
})

test('actual chat health marks only an explicitly failed final upload as exhausted', () => {
    const sfc = readFileSync(new URL('../components/ui/BossMessage.vue', import.meta.url), 'utf8')
    const script = sfc.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
    const source = ts.createSourceFile('BossMessage.ts', script, ts.ScriptTarget.Latest, true)
    const declaration = source.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations)
        .find(node => node.name.getText(source) === 'refreshChatHealth')
    const body = declaration.initializer.getText(source)
    const refs = Object.fromEntries([...body.matchAll(/(\w+)\.value/g)].map(match => [match[1], {value: 0}]))
    const row = {status: 'queued', upload: {attempts: 5, error: '等待审计上传确认'}}
    const refresh = runInNewContext(ts.transpileModule('(' + body + ')', {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText, {...refs, GM_getValue: () => '', localStorage: {getItem: () => ''}, countBlockingDeliveries: () => 0,
        Tools: {window: {}}, userStore: {user: {preference: {}}}, backfillVisibleGreetingReceipts() {},
        reconcileDeliveryAuditFromDom: () => [row], BossOption: {getUnreadRecoveryHealth: () => ({obscured: 0, unresolved: 0})},
        document: {querySelectorAll: () => []}, getBossRiskStop: () => null})
    refresh()
    assert.equal(refs.auditPendingCount.value, 1)
    assert.equal(refs.auditFailedCount.value, 0)
    row.upload.error = '审计上传失败，已停止自动重试'
    refresh()
    assert.equal(refs.auditPendingCount.value, 0)
    assert.equal(refs.auditFailedCount.value, 1)
    row.upload.sentAt = Date.now()
    refresh()
    assert.equal(refs.auditFailedCount.value, 0)
})
