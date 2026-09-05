import assert from 'node:assert/strict'
import test from 'node:test'

import {GM_STORAGE_PREFIX, SynchronousGmStorage} from './gmStorage.ts'

class MemoryStorage {
    values = new Map()

    get length() {
        return this.values.size
    }

    key(index) {
        return [...this.values.keys()][index] ?? null
    }

    getItem(key) {
        return this.values.get(key) ?? null
    }

    setItem(key, value) {
        this.values.set(key, String(value))
    }

    removeItem(key) {
        this.values.delete(key)
    }
}

class StorageEvents {
    listeners = new Set()

    addEventListener(type, listener) {
        if (type === 'storage') this.listeners.add(listener)
    }

    removeEventListener(type, listener) {
        if (type === 'storage') this.listeners.delete(listener)
    }

    dispatch(event) {
        this.listeners.forEach(listener => listener(event))
    }
}

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve))

test('GM storage keeps get/set synchronous and preserves structured values', () => {
    const gm = new SynchronousGmStorage(new MemoryStorage(), new StorageEvents())
    assert.equal(gm.getValue('missing', 'fallback'), 'fallback')
    assert.equal(gm.setValue('mirror_user_config_global_latest', {enabled: true, limit: 3}), true)
    assert.deepEqual(gm.getValue('mirror_user_config_global_latest', null), {enabled: true, limit: 3})
    assert.equal(gm.setValue('mirror_user_config_global_latest', undefined), true)
    assert.equal(gm.getValue('mirror_user_config_global_latest', 'fallback'), 'fallback')
})

test('same-tab listeners are local and cross-tab storage events are remote', async () => {
    const storage = new MemoryStorage()
    const events = new StorageEvents()
    const gm = new SynchronousGmStorage(storage, events)
    const changes = []
    gm.addValueChangeListener('ai-job-pending-greetings-v1', (...args) => changes.push(args))

    gm.setValue('ai-job-pending-greetings-v1', ['local'])
    await flushMicrotasks()
    events.dispatch({
        key: GM_STORAGE_PREFIX + 'ai-job-pending-greetings-v1',
        oldValue: JSON.stringify({value: ['local']}),
        newValue: JSON.stringify({value: ['remote']}),
    })
    await flushMicrotasks()

    assert.deepEqual(changes, [
        ['ai-job-pending-greetings-v1', undefined, ['local'], false],
        ['ai-job-pending-greetings-v1', ['local'], ['remote'], true],
    ])
    gm.dispose()
})

test('old and new AI config mirrors never retain apiKey material', () => {
    const storage = new MemoryStorage()
    const mirrorKey = 'mirror_ai_config_global_latest'
    storage.setItem(GM_STORAGE_PREFIX + mirrorKey, JSON.stringify({
        value: {provider: 1, modelName: 'deepseek-chat', apiKey: 'old-secret', timeout: 15},
    }))
    const gm = new SynchronousGmStorage(storage, new StorageEvents())
    assert.deepEqual(gm.getValue(mirrorKey, null), {provider: 1, modelName: 'deepseek-chat', timeout: 15})
    assert.equal(gm.setValue(mirrorKey, {provider: 2, apiKey: 'new-secret', timeout: 30}), true)
    assert.deepEqual(gm.getValue(mirrorKey, null), {provider: 2, timeout: 30})
    assert.equal(storage.getItem(GM_STORAGE_PREFIX + mirrorKey).includes('secret'), false)
})

test('unclassified keys and values containing credentials are rejected', () => {
    const storage = new MemoryStorage()
    const gm = new SynchronousGmStorage(storage, new StorageEvents())
    assert.equal(gm.setValue('Authorization', 'Bearer abc'), false)
    assert.equal(gm.setValue('messageCache', {token: 'boss-session'}), false)
    assert.equal(gm.setValue('logs_data', 'Bearer abcdefghijklmnop'), false)
    assert.equal(storage.length, 0)
})

test('QuotaError and SecurityError fall back without crashing startup', () => {
    const unavailable = {
        getItem() {
            throw new DOMException('blocked', 'SecurityError')
        },
        setItem() {
            throw new DOMException('full', 'QuotaExceededError')
        },
        removeItem() {
            throw new DOMException('blocked', 'SecurityError')
        },
    }
    const gm = new SynchronousGmStorage(unavailable, new StorageEvents())
    assert.equal(gm.getValue('custom_server_url', 'http://127.0.0.1:9100/'), 'http://127.0.0.1:9100/')
    assert.equal(gm.setValue('custom_server_url', 'http://127.0.0.1:9100/'), false)
})
