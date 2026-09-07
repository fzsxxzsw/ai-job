import assert from 'node:assert/strict'
import test from 'node:test'
import {createBackgroundService} from './backgroundService.ts'
import {BACKGROUND_CHANNEL, BRIDGE_PROTOCOL_VERSION, MAIN_WORLD_SOURCE, ISOLATED_WORLD_SOURCE, parsePageBridgeRequest, toBackgroundRequest} from './bridgeProtocol.ts'

const command = {kind: 'session', authorization: 'local-test-token', serverUrl: 'http://127.0.0.1:9100', platformAccount: '90071992547409931'}
const envelope = payload => ({protocol: BRIDGE_PROTOCOL_VERSION, source: MAIN_WORLD_SOURCE, target: ISOLATED_WORLD_SOURCE,
    requestId: 'outcome-request', operation: 'outcomes.command', payload})
const sender = {url: 'https://www.zhipin.com/web/geek/chat', tab: {id: 1}, frameId: 0, documentId: 'document-1'}

test('automatic outcomes use the named, validated isolated bridge and never the arbitrary HTTP proxy', async () => {
    const seen = []
    const service = createBackgroundService({fetch: async () => { throw new Error('unexpected legacy network') },
        createNotification: async () => '', clearNotification: async () => true,
        setTimer: setTimeout, clearTimer: clearTimeout,
        outcomes: {handle: async (payload, owner) => { seen.push({payload, owner}); return {scope: 'scoped-result', items: []} }}})
    const parsed = parsePageBridgeRequest(envelope(command))
    const response = await service.handleMessage(toBackgroundRequest(parsed), sender)
    assert.equal(response.operation, 'outcomes-response')
    assert.equal(response.payload.scope, 'scoped-result')
    assert.equal(seen[0].payload.platformAccount, '90071992547409931')
    assert.equal(response.channel, BACKGROUND_CHANNEL)
    assert.equal(JSON.stringify(response).includes('local-test-token'), false)
    assert.equal(parsePageBridgeRequest(envelope({...command, userId: '3'})), null)
    assert.equal(parsePageBridgeRequest(envelope({...command, url: 'https://evil.test'})), null)
    assert.equal((await service.handleMessage(toBackgroundRequest(parsed), {...sender, url: 'https://evil.test'})).ok, false)
    assert.equal(seen.length, 1)
})
