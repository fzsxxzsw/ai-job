import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('./weekendPolicy.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const module = {exports: {}}
vm.runInNewContext(compiled, {module, exports: module.exports})
const {weekendBenefitStatus} = module.exports

test('recognises explicit weekend policies without excluding missing information', () => {
    assert.equal(weekendBenefitStatus('福利：五险一金，周末双休'), 'POSITIVE')
    assert.equal(weekendBenefitStatus('工作时间周一至周五'), 'POSITIVE')
    assert.equal(weekendBenefitStatus('大小周，偶尔加班'), 'NEGATIVE')
    assert.equal(weekendBenefitStatus('双休不固定，按项目安排'), 'NEGATIVE')
    assert.equal(weekendBenefitStatus('餐补、带薪年假'), 'UNKNOWN')
})
