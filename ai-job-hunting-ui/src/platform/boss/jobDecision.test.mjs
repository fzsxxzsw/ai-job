import assert from 'node:assert/strict'
import test from 'node:test'

import {normalizeAiJobDecision} from './jobDecision.ts'

test('accepts an explicit MATCH decision and clamps its score', () => {
    assert.deepEqual(normalizeAiJobDecision({
        decisionStatus: 'match',
        filter: true,
        reason: '结构完整，分数仅供参考',
        score: 108,
    }), {
        status: 'MATCH',
        filter: false,
        reason: '结构完整，分数仅供参考',
        score: 100,
        cacheable: true,
    })
})

test('keeps backward compatibility with legacy filter responses', () => {
    assert.equal(normalizeAiJobDecision({filter: true, reason: '命中排除条件'}).status, 'REJECT')
    assert.equal(normalizeAiJobDecision({filter: false, reason: '通过'}).status, 'MATCH')
})

test('fails closed when the response is empty or malformed', () => {
    for (const payload of [null, undefined, {}, {decisionStatus: 'MAYBE'}, {reason: '只有原因'}]) {
        const result = normalizeAiJobDecision(payload)
        assert.equal(result.status, 'UNKNOWN')
        assert.equal(result.filter, true)
        assert.equal(result.cacheable, false)
    }
})

test('an explicit UNKNOWN never becomes cacheable even with filter false', () => {
    const result = normalizeAiJobDecision({
        decisionStatus: 'UNKNOWN',
        filter: false,
        reason: '模型超时',
    })
    assert.equal(result.status, 'UNKNOWN')
    assert.equal(result.filter, true)
    assert.equal(result.cacheable, false)
})

test('preserves local rule explanations for logs and review', () => {
    const result = normalizeAiJobDecision({
        decisionStatus: 'MATCH',
        filter: false,
        reason: '本地规则完成',
        score: 67,
        engine: 'LOCAL_RULES_V2',
        matchedStrengths: ['Java'],
        gaps: ['Redis'],
        titleScore: 100,
        skillScore: 49,
        confidence: 'HIGH',
        evidenceCount: 4,
    })
    assert.equal(result.engine, 'LOCAL_RULES_V2')
    assert.deepEqual(result.matchedStrengths, ['Java'])
    assert.deepEqual(result.gaps, ['Redis'])
    assert.equal(result.titleScore, 100)
    assert.equal(result.skillScore, 49)
    assert.equal(result.confidence, 'HIGH')
    assert.equal(result.evidenceCount, 4)
})
