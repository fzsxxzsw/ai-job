import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import test from 'node:test'
import {parse, compileScript} from 'vue/compiler-sfc'
import {transformSync} from 'esbuild'

const require = createRequire(import.meta.url)
const filename = new URL('./CompanyExclusionsInput.vue', import.meta.url).pathname
const {descriptor} = parse(readFileSync(new URL('./CompanyExclusionsInput.vue', import.meta.url), 'utf8'), {filename})
const script = compileScript(descriptor, {id: 'keyword-test'})
const code = transformSync(script.content, {loader: 'ts', format: 'cjs'}).code
const module = {exports: {}}
new Function('require', 'module', 'exports', code)(require, module, module.exports)

function editor() {
    const props = {modelValue: ['已有公司'], protectedKeywords: ['内置公司']}
    const state = module.exports.default.setup(props, {expose() {}, emit(event, values) {
        assert.equal(event, 'update:modelValue')
        props.modelValue = values
    }})
    return {props, state}
}

test('Enter adds trimmed keywords once; repeating Enter does not remove them', () => {
    const {props, state} = editor()
    let prevented = 0
    const enter = {key: 'Enter', preventDefault() {prevented++}, stopPropagation() {}}
    state.draft.value = '  新公司  '
    state.onKeydown(enter)
    assert.deepEqual(props.modelValue, ['已有公司', '新公司'])
    assert.equal(state.draft.value, '')
    state.draft.value = '新公司'
    state.onKeydown(enter)
    assert.deepEqual(props.modelValue, ['已有公司', '新公司'])
    assert.match(state.feedback.value, /已在排除列表/)
    assert.equal(prevented, 2)
})

test('IME confirmation does not prematurely add or clear a Chinese keyword', () => {
    for (const guard of ['isComposing', 'keyCode', 'component']) {
        const {props, state} = editor()
        state.draft.value = '输入中的公司'
        state.composing.value = guard === 'component'
        state.onKeydown({key: 'Enter', isComposing: guard === 'isComposing', keyCode: guard === 'keyCode' ? 229 : 13,
            preventDefault() {assert.fail('IME Enter must remain untouched')}, stopPropagation() {assert.fail('IME Enter must remain untouched')}})
        assert.deepEqual(props.modelValue, ['已有公司'])
        assert.equal(state.draft.value, '输入中的公司')
    }
})

test('button addition, empty input, protected keywords and explicit removal have predictable results', () => {
    const {props, state} = editor()
    state.draft.value = ' '
    state.addKeyword()
    state.draft.value = '内置公司'
    state.addKeyword()
    assert.deepEqual(props.modelValue, ['已有公司'])
    assert.match(state.feedback.value, /内置规则/)
    state.draft.value = '按钮添加'
    state.addKeyword()
    state.removeKeyword('已有公司')
    assert.deepEqual(props.modelValue, ['按钮添加'])
})
