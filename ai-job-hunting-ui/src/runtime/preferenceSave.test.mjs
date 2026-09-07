import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import test from 'node:test'
import axios from 'axios'
import {preferencePayload, savePreference, preferenceSaveFailure} from './preferenceSave.ts'
import {ApiRequestError} from './requestErrors.ts'

const fixture = JSON.parse(readFileSync(new URL('../../../ai-job-api/tests/fixtures/preference-save.json', import.meta.url), 'utf8'))

test('saving a loaded user sends the same bounded contract accepted by the API', async () => {
    let received
    const server = createServer(async (request, response) => {
        let raw = ''
        for await (const chunk of request) raw += chunk
        received = {url: request.url, payload: JSON.parse(raw)}
        response.setHeader('Content-Type', 'application/json')
        response.end('{"code":200}')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
        const client = axios.create({baseURL: `http://127.0.0.1:${server.address().port}`, proxy: false})
        let feedback
        client.interceptors.request.use(config => { feedback = config.suppressGlobalErrorToast; return config })
        const response = await savePreference(client, fixture.user)
        assert.equal(response.data.code, 200)
        assert.deepEqual(received, {url: '/api/user/save/preference', payload: fixture.payload})
        assert.equal(feedback, true)
        assert.equal(fixture.user.resumeId, 'resume-old')
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('explicitly clearing contacts and disabling replies are preserved', () => {
    const payload = preferencePayload({...fixture.user, phone: '', email: '', aiSeatStatus: false})
    assert.equal(payload.phone, '')
    assert.equal(payload.email, '')
    assert.equal(payload.aiSeatStatus, 0)
})

test('validation, authentication, and server failures are not reported as offline', () => {
    for (const [status, message] of [[422, '请求参数格式或长度不正确'], [401, '登录已过期'], [500, '服务内部异常']]) {
        const feedback = preferenceSaveFailure(new ApiRequestError(message, status, {status, data: {message}}))
        assert.equal(feedback.type, 'error')
        assert.ok(feedback.message.includes(message))
        assert.doesNotMatch(feedback.message, /离线|无法连接/)
    }
})

test('connection loss, timeout and failed local persistence have distinct feedback', () => {
    assert.match(preferenceSaveFailure(new ApiRequestError('network', 'ERR_NETWORK')).message, /无法连接本地服务/)
    assert.match(preferenceSaveFailure(new ApiRequestError('timeout', 'ECONNABORTED')).message, /是否保存尚未确认/)
    const failure = preferenceSaveFailure(new ApiRequestError('bad input', 422), false)
    assert.match(failure.message, /本地备份也未成功/)
    assert.doesNotMatch(failure.message, /已保存在本地/)
})
