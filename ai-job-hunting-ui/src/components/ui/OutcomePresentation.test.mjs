import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {outcomeLivePresentation} from '../../extension/outcomesProtocol.ts'

const report = Object.freeze({reportId: 'saved-invitation', revision: 1, outcome: 'POSITIVE', waitingOn: 'USER', readState: 'UNKNOWN',
    asOf: 1788757200000, summary: 'HR 邀请面试，等待你的答复。', isCurrent: true})

test('positive invitation followed by USER courtesy shows no pending reply while the saved report keeps its asOf facts', () => {
    const item = Object.freeze({revision: 1, outcome: 'POSITIVE', readState: 'READ', waitingOn: 'NONE', lastObservedAt: 1788757210000, report})
    const before = JSON.stringify(item)
    const view = outcomeLivePresentation(item)
    assert.equal(view.label, '积极回应')
    assert.equal(view.status, '当前无需回复 · 对方已读')
    assert.equal(view.observedAt, 1788757210000)
    assert.equal(item.report.waitingOn, 'USER')
    assert.equal(item.report.readState, 'UNKNOWN')
    assert.equal(item.report.asOf, 1788757200000)
    assert.equal(JSON.stringify(item), before)
})

test('live state updates without any report and never substitutes a saved report for missing live fields', () => {
    const before = {outcome: 'WAITING', readState: 'UNREAD', waitingOn: 'HR', lastObservedAt: 1788757200000, report: null}
    const after = {...before, outcome: 'REPLIED', readState: 'READ', waitingOn: 'NONE', lastObservedAt: 1788757210000}
    assert.equal(outcomeLivePresentation(before).status, '等待 HR · 对方未读')
    assert.equal(outcomeLivePresentation(after).status, '当前无需回复 · 对方已读')
    assert.equal(outcomeLivePresentation(after).label, 'HR 已回复')
    assert.equal(outcomeLivePresentation({report}).status, '下一步未知 · 阅读状态未知')
})

test('report UI wires live case state separately from explicitly dated report state', () => {
    const source = readFileSync(new URL('./OutcomeReports.vue', import.meta.url), 'utf8')
    assert.match(source, /当前状态：\{\{ outcomeLivePresentation\(item\)\.status \}\}/)
    assert.match(source, /报告生成时：\{\{ waitingLabel\(item\.report\.waitingOn\) \}\}/)
    assert.match(source, /报告观察截至 \{\{ formatTime\(item\.report\.asOf\) \}\}/)
    assert.doesNotMatch(source, /outcomeLivePresentation\(item\.report\)/)
})
