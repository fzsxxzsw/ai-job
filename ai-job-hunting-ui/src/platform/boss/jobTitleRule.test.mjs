import assert from 'node:assert/strict'
import test from 'node:test'

import {evaluateJobTitleRule} from './jobTitleRule.ts'

const TARGET_KEYWORDS = [
    'AI', 'AI应用', '人工智能', '大模型', 'Agent', '智能体',
    '全栈', '前端', '后端', '开发', '研发', '程序员',
    '算法', 'Python', 'Java', '软件工程师',
]

function decide(jobName, postDescription = '') {
    return evaluateJobTitleRule({
        jobName,
        postDescription,
        includeKeywords: TARGET_KEYWORDS,
        excludeKeywords: [],
        mode: 'required',
    })
}

test('skips the reported non-technical mediator and beauty streamer roles', () => {
    assert.equal(decide('诉前调解员15K-20K').status, 'SKIP')
    assert.equal(decide('抖音美妆主播-杭州滨江区长河').status, 'SKIP')
})

test('passes strong target software titles without AI', () => {
    for (const title of [
        'AIGC应用全栈工程师',
        'Python开发工程师',
        'Java后端开发',
        'Agent智能体研发工程师',
        '软件工程师',
    ]) {
        assert.equal(decide(title).status, 'PASS', title)
    }
})

test('does not let a broad 开发 keyword admit business development', () => {
    assert.equal(decide('市场开发经理').status, 'SKIP')
    assert.equal(decide('客户开发专员').status, 'SKIP')
})

test('explicit non-technical semantics outrank incidental strong tech words', () => {
    assert.equal(decide('Java课程顾问').status, 'SKIP')
    assert.equal(decide('AI产品运营').status, 'SKIP')
    assert.equal(decide('Python招聘专员').status, 'SKIP')
})

test('allows a broad keyword only when the JD supplies multiple technical facts', () => {
    const decision = decide(
        '应用开发',
        '负责系统编码和接口开发，使用 TypeScript、Vue、Java、Spring，并维护 MySQL 数据库。',
    )
    assert.equal(decision.status, 'PASS')
})

test('custom title exclusions always win', () => {
    const decision = evaluateJobTitleRule({
        jobName: 'Java后端开发（外包）',
        includeKeywords: TARGET_KEYWORDS,
        excludeKeywords: ['外包'],
        mode: 'required',
    })
    assert.equal(decision.status, 'SKIP')
    assert.match(decision.reason, /外包/)
})

test('required mode with no keywords fails safely while off mode passes', () => {
    assert.equal(evaluateJobTitleRule({jobName: '任意岗位', mode: 'required'}).status, 'SKIP')
    assert.equal(evaluateJobTitleRule({jobName: '任意岗位', mode: 'off'}).status, 'PASS')
})
