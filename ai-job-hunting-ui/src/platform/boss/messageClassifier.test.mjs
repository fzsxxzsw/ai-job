import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

import {classifyBossMessage} from './messageClassifier.ts'

const own = '40'
const peer = '81'
const message = ({from = peer, to = own, mid = '90071992547409941', type = 1,
    bodyType = 1, text = '方便聊聊吗？'} = {}) => ({
    mid,
    type,
    from: {uid: from},
    to: {uid: to},
    body: {type: bodyType, text},
})

test('classifies only exact participant-bound text as recruiter or user messages', () => {
    assert.equal(classifyBossMessage(message(), own).kind, 'RECRUITER_TEXT')
    assert.equal(classifyBossMessage(message({from: own, to: peer}), own).kind, 'USER_TEXT')
    assert.equal(classifyBossMessage(message({to: '82'}), own).kind, 'UNVERIFIABLE')
    assert.equal(classifyBossMessage(message({mid: 'dom:synthetic'}), own).kind, 'UNVERIFIABLE')
})

test('platform and non-text payloads never become recruiter replies', () => {
    for (const candidate of [
        message({type: 4, text: '你与该职位竞争者PK情况'}),
        message({bodyType: 12, text: '附件简历预览'}),
        message({bodyType: 14, text: '面试日程卡片'}),
        message({bodyType: 1, text: '对方拒绝了您的发送请求'}),
        message({bodyType: 3, text: ''}),
    ]) {
        assert.notEqual(classifyBossMessage(candidate, own).kind, 'RECRUITER_TEXT')
    }
})

test('only known exact exchange cards are recruiter requests', () => {
    for (const text of ['交换微信', '交换联系方式', '我想要一份您的附件简历，您是否同意']) {
        assert.equal(classifyBossMessage(message({bodyType: 7, text}), own).kind, 'RECRUITER_REQUEST')
    }
    assert.equal(classifyBossMessage(message({bodyType: 7, text: '您对本职位的求职过程满意吗'}), own).kind,
        'PLATFORM_SYSTEM')
})

test('the WebSocket ingress classifies before outcome collection or AI dispatch', () => {
    const source = readFileSync(new URL('../../webSocket/hookMain.ts', import.meta.url), 'utf8')
    const classifyAt = source.indexOf('classifyBossMessage(message')
    const observeAt = source.indexOf('observeOutcomeMessage(message')
    const dispatchAt = source.indexOf('handlerBossMessage(wsData')
    assert.ok(classifyAt > 0)
    assert.ok(observeAt > classifyAt)
    assert.ok(dispatchAt > classifyAt)
    assert.match(source.slice(classifyAt, observeAt), /if \(!isOutcomeMessage\(classification\.kind\)\)[\s\S]*return/)
})
