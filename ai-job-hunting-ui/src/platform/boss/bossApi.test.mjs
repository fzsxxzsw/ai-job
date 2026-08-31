import assert from 'node:assert/strict'
import test from 'node:test'

import {BossContractError, buildBossJobCardQuery, parseBossJobCardResponse} from './bossApi.ts'

test('normalizes a valid job card without depending on response language', () => {
    const card = parseBossJobCardResponse({
        code: 0,
        message: '操作成功',
        zpData: {jobCard: {
            postDescription: '负责核心系统开发',
            activeTimeDesc: '刚刚活跃',
            address: '上海市浦东新区',
            friendStatus: 1,
        }},
    })
    assert.equal(card.postDescription, '负责核心系统开发')
    assert.equal(card.friendStatus, 1)
})

test('rejects a nominally successful response without a job card', () => {
    assert.throws(
        () => parseBossJobCardResponse({code: 0, zpData: {}}),
        error => error instanceof BossContractError && error.code === 'DETAIL_CARD_MISSING',
    )
})

test('rejects an empty JD before filtering or AI matching can continue', () => {
    assert.throws(
        () => parseBossJobCardResponse({code: 0, zpData: {jobCard: {postDescription: '  '}}}),
        error => error instanceof BossContractError && error.code === 'DETAIL_JD_MISSING',
    )
})

test('encodes job card query values instead of concatenating raw strings', () => {
    assert.equal(
        buildBossJobCardQuery({lid: 'a&b', securityId: 'sec=1'}),
        'lid=a%26b&securityId=sec%3D1&sessionId=',
    )
})
