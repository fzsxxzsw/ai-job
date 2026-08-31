import assert from 'node:assert/strict'
import test from 'node:test'
import {
    collectBossLimitTexts,
    detectBossDailyLimit,
    isLegacyLocalDailyLimit,
    makeBossDailyLimitKey,
    makePushFailCountKey,
    makePushSuccessCountKey,
    nextSharedDailyCounterValue,
} from './bossDailyLimit.ts'

test('distinguishes obsolete local caps from genuine platform limits', () => {
    assert.equal(isLegacyLocalDailyLimit('本地安全日上限 20 个，今日已停止新增沟通'), true)
    assert.equal(isLegacyLocalDailyLimit('BOSS 当日沟通上限：今日沟通人数已达上限'), false)
    assert.equal(isLegacyLocalDailyLimit(true), false)
})

test('recognizes nested chat reminder daily communication limit', () => {
    const response = {
        data: {
            code: 1,
            zpData: {bizData: {chatRemindDialog: {content: '今日沟通人数已达上限，请明日再试'}}},
        },
    }
    assert.equal(detectBossDailyLimit(response)?.matchedText, '今日沟通人数已达上限，请明日再试')
})

test('recognizes axios error and common opening/application wording', () => {
    assert.ok(detectBossDailyLimit({response: {data: {message: '当天开聊人数已达到上限'}}}))
    assert.ok(detectBossDailyLimit({msg: '今日投递次数已用完'}))
    assert.ok(detectBossDailyLimit({data: {zpData: {message: '本日打招呼名额已满'}}}))
    assert.ok(detectBossDailyLimit({message: '今天已与100位BOSS沟通，明天再来吧'}))
})

test('does not mistake ordinary counts or unrelated job description for a limit', () => {
    assert.equal(detectBossDailyLimit({message: '今天已经沟通 8 位 BOSS，还可以继续'}), null)
    assert.equal(detectBossDailyLimit({jobDescription: '负责每日投递次数达到业务上限后的告警'}), null)
    assert.equal(detectBossDailyLimit({message: '该职位已关闭'}), null)
})

test('handles cyclic responses and deduplicates message text', () => {
    const response = {message: '今日沟通额度已用完'}
    response.response = response
    assert.deepEqual(collectBossLimitTexts(response), ['今日沟通额度已用完'])
    assert.ok(detectBossDailyLimit(response))
})

test('builds a date-scoped key that changes the next day', () => {
    assert.equal(makeBossDailyLimitKey(new Date(2026, 7, 25)), 'push_limit2026-08-25')
    assert.equal(makeBossDailyLimitKey(new Date(2026, 7, 26)), 'push_limit2026-08-26')
    assert.equal(makePushSuccessCountKey(new Date(2026, 7, 25)), 'pushSuccessCount:2026-08-25')
    assert.equal(makePushSuccessCountKey(new Date(2026, 7, 26)), 'pushSuccessCount:2026-08-26')
    assert.equal(makePushFailCountKey(new Date(2026, 7, 26)), 'pushFailCount:2026-08-26')
})

test('increments from the newest shared count instead of overwriting it with a stale tab value', () => {
    assert.equal(nextSharedDailyCounterValue(3, 7), 8)
    assert.equal(nextSharedDailyCounterValue(9, 4), 10)
    assert.equal(nextSharedDailyCounterValue('invalid', undefined), 1)
})
