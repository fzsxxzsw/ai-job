import test from 'node:test'
import assert from 'node:assert/strict'
import {feedbackOptions, createToastGate, replyNoticeText} from './feedback.ts'
import {ApiRequestError, responseErrorMessage} from '../runtime/requestErrors.ts'

test('feedback clones options, groups messages and disables HTML parsing', () => {
    const value=Object.freeze({message:'<b>literal</b>',dangerouslyUseHTMLString:true})
    const result=feedbackOptions(value,'error')
    assert.equal(result.message,'[AI助理] <b>literal</b>')
    assert.equal(result.dangerouslyUseHTMLString,false);assert.equal(result.grouping,true)
    assert.equal(value.message,'<b>literal</b>')
})
test('prefix is idempotent and structured content is not stringified', () => {
    const result=feedbackOptions(feedbackOptions('hello'))
    assert.equal(result.message,'[AI助理] hello')
    const node={__v_isVNode:true,children:'content'}
    assert.equal(feedbackOptions({message:node}).message,node)
})
test('five identical errors in a burst yield only one toast opportunity', () => {
    let now=1; const allow=createToastGate(3000,()=>now)
    assert.equal([1,2,3,4,5].filter(()=>allow('same')).length,1)
    assert.equal(allow('different'),true)
    now=4000;assert.equal(allow('same'),true)
})
test('reply notice keeps markup literal and never includes avatar URLs', () => {
    const text=replyNoticeText('候选<b>人','内容含 <div> 标签','回答 & <strong>')
    assert.match(text,/<div>/);assert.match(text,/AI助手/)
    assert.equal(text.includes('<img'),false)
})
test('all normalized request errors have a message, code and Error identity', () => {
    const error=new ApiRequestError('登录过期',401)
    assert.ok(error instanceof Error);assert.equal(error.code,401)
    assert.equal(responseErrorMessage({message:'bad object'}),'服务返回异常，请稍后重试')
})
