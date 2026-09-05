import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {isPersonalMode, IS_PERSONAL_MODE} from './deploymentMode.ts'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('personal UI is the default and commercial UI requires explicit false', () => {
    assert.equal(IS_PERSONAL_MODE, true)
    for (const value of [undefined, '', 'true', ' TRUE ']) assert.equal(isPersonalMode(value), true)
    for (const value of ['false', ' FALSE ']) assert.equal(isPersonalMode(value), false)
})
test('personal build never mounts the global purchase dialog', () => {
    assert.match(read('./App.vue'), /<Product v-if="!IS_PERSONAL_MODE"/)
    assert.match(read('./axios.ts'), /if \(!IS_PERSONAL_MODE && result.code === BizCodeEnum.PRODUCT_NOT_AUTHORIZED\)/)
})
test('personal toolbar and payment actions are guarded without removing AI reply', () => {
    const page = read('./components/ui/AiJob.vue')
    assert.match(page, /<el-button v-if="!IS_PERSONAL_MODE"[^>]*[\s\S]*?handlerAISeatClick/)
    assert.match(page, /<el-dialog v-if="!IS_PERSONAL_MODE" v-model="aiSeatBuyVisible"/)
    for (const name of ['handlerAISeatClick', 'showOrderGroup', 'waitUsePay']) {
        assert.ok(page.includes(`${name} = ${name === 'waitUsePay' ? '' : 'async '}() => {\n    if (IS_PERSONAL_MODE) return`))
    }
    assert.match(page, /@change="handlerAISeatStatusChange"/)
})
test('personal menu hides invitation sales and shows the personal guide', () => {
    assert.match(read('./components/ui/Panel.vue'), /if \(!IS_PERSONAL_MODE\) componentMap.set\('5'/)
    assert.match(read('./components/ui/UseDocument.vue'), /<PersonalDocument v-if="IS_PERSONAL_MODE"/)
})
