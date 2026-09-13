import assert from 'node:assert/strict'
import test from 'node:test'

import {evaluateJobTitleRule, hasPotentialDeveloperTitle, isClearlyNonDeveloperTitle} from './jobTitleRule.ts'

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

test('blocks the reported AI video and MCN roles even when keywords are off', () => {
    for (const title of [
        'AI视频制作',
        'AIGC视频制作师',
        '编导（MCN 剧情方向 · 杭州可居家办公）',
        '短视频剪辑（AI方向）',
        'AI运营经理（ChatGPT + Codex 方向）-双休',
        'AIGC广告导演',
        '跨境短视频AI工程师（跨境业务）',
        '实施顾问（企业AI Agent落地）',
        '技术支持工程师',
    ]) {
        assert.equal(isClearlyNonDeveloperTitle(title), true, title)
        assert.equal(evaluateJobTitleRule({jobName: title, mode: 'off'}).status, 'SKIP', title)
        assert.equal(decide(title, '使用 AIGC、Python 和 AI 工具制作内容').status, 'SKIP', title)
    }
})

test('off mode still accepts developer titles without configured keywords', () => {
    for (const title of [
        'AI全栈工程师',
        '区块链工程师',
        'Java后端开发',
        '短视频推荐算法工程师',
        '短视频AI推荐算法工程师',
        '计算摄影算法工程师',
        '运营平台开发工程师',
    ]) {
        assert.equal(isClearlyNonDeveloperTitle(title), false, title)
        assert.equal(hasPotentialDeveloperTitle(title), true, title)
        assert.equal(evaluateJobTitleRule({jobName: title, mode: 'off'}).status, 'PASS', title)
    }
    assert.equal(evaluateJobTitleRule({jobName: 'AI工程师', mode: 'off'}).status, 'SKIP')
    assert.equal(evaluateJobTitleRule({
        jobName: 'AI工程师',
        postDescription: '负责系统编码和接口开发，使用 Python、Java 与 MySQL。',
        mode: 'off',
    }).status, 'PASS')
})

test('skips titles with no developer role before requesting a job description', () => {
    for (const title of ['新媒体策划', 'AI绘画师', '商业分析师']) {
        assert.equal(hasPotentialDeveloperTitle(title), false, title)
        assert.equal(evaluateJobTitleRule({jobName: title, mode: 'off'}).status, 'SKIP', title)
    }
    assert.equal(hasPotentialDeveloperTitle('AI工程师'), true)
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
        '研发工程师',
        '负责系统编码和接口开发，使用 TypeScript、Vue、Java、Spring，并维护 MySQL 数据库。',
    )
    assert.equal(decision.status, 'PASS')
    assert.equal(decide('研发工程师').status, 'SKIP')
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

test('required mode with no keywords fails safely while off mode retains the developer floor', () => {
    assert.equal(evaluateJobTitleRule({jobName: '任意岗位', mode: 'required'}).status, 'SKIP')
    assert.equal(evaluateJobTitleRule({jobName: '任意岗位', mode: 'off'}).status, 'SKIP')
    assert.equal(evaluateJobTitleRule({jobName: 'Python开发工程师', mode: 'off'}).status, 'PASS')
})
