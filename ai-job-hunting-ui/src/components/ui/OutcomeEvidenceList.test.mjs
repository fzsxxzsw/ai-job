import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import {parse, compileScript} from 'vue/compiler-sfc'
import {transform} from 'esbuild'
import {createSSRApp} from 'vue'
import {renderToString} from 'vue/server-renderer'
import {outcomeReportNotice} from '../../extension/outcomesProtocol.ts'

const source = readFileSync(new URL('./OutcomeEvidenceList.vue', import.meta.url), 'utf8')
const {descriptor} = parse(source)
const script = compileScript(descriptor, {id: 'outcome-evidence-test', inlineTemplate: true})
const output = await transform(script.content, {loader: 'ts', format: 'cjs', target: 'esnext'})
const module = {exports: {}}
vm.runInNewContext(output.code, {module, exports: module.exports, require: createRequire(import.meta.url)})

test('public evidence renders HR, job, resume and positive quotes with their real source labels', async () => {
    const evidence = [
        {evidenceId: 'D1', source: 'CHAT', messageId: '90071992547409933', role: 'HR', quote: '岗位经验不符'},
        {evidenceId: 'J1', source: 'JOB', messageId: null, role: null, quote: '需要三年 Java 经验'},
        {evidenceId: 'R1', source: 'RESUME', messageId: null, role: null, quote: '投递时履历为一年'},
        {evidenceId: 'M:90071992547409934', source: 'CHAT', messageId: '90071992547409934', role: 'HR', quote: '明天下午来面试'},
    ]
    const html = await renderToString(createSSRApp(module.exports.default, {evidence}))
    for (const text of ['HR', '岗位经验不符', '岗位描述', '需要三年 Java 经验', '投递时简历', '投递时履历为一年', '明天下午来面试']) assert.ok(html.includes(text), text)
    assert.equal(html.includes('undefined'), false)
    assert.match(source, /:key="item.evidenceId"/)
})
test('superseded report has an explicit previous-version notice and feedback never claims to resume a different task', () => {
    assert.equal(outcomeReportNotice({revision: 2, report: {revision: 1, isCurrent: false}}), '上一版报告，新分析处理中')
    assert.equal(outcomeReportNotice({revision: 2, report: {revision: 2, isCurrent: true}}), '当前版本报告')
    const reports = readFileSync(new URL('./OutcomeReports.vue', import.meta.url), 'utf8')
    assert.match(reports, /outcomeReportNotice\(item\)/)
    assert.match(reports, /本版本报告的反馈已保存/)
    assert.equal(reports.includes('任务将从确认阶段继续'), false)
})
