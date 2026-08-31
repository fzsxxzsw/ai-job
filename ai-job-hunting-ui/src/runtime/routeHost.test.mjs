import assert from 'node:assert/strict'
import test from 'node:test'

import {findBossMountTarget, getBossViewKey, observeBossRoute, shouldRecoverBossMount} from './routeHost.ts'

class FakeWindow extends EventTarget {
    constructor(href) {
        super()
        this.location = {href}
        this.Event = Event
        this.history = {
            pushState: (_state, _unused, url) => {
                if (url) this.location.href = new URL(String(url), this.location.href).href
            },
            replaceState: (_state, _unused, url) => {
                if (url) this.location.href = new URL(String(url), this.location.href).href
            },
        }
    }
}

test('classifies BOSS SPA routes without jobs swallowing job-recommend', () => {
    assert.equal(getBossViewKey('https://www.zhipin.com/web/geek/chat'), 'chat')
    assert.equal(getBossViewKey('https://www.zhipin.com/web/geek/job-recommend'), 'job-recommend')
    assert.equal(getBossViewKey('https://www.zhipin.com/web/geek/jobs?query=java'), 'jobs')
    assert.equal(getBossViewKey('https://www.zhipin.com/web/geek/job'), 'job')
    assert.equal(getBossViewKey('https://www.zhipin.com/overseas/job'), 'overseas')
})

test('observes pushState and replaceState exactly once per href change', () => {
    const target = new FakeWindow('https://www.zhipin.com/web/geek/jobs')
    const seen = []
    const subscription = observeBossRoute(target, href => seen.push(href))

    target.history.pushState({}, '', '/web/geek/chat')
    target.history.replaceState({}, '', '/web/geek/chat')
    target.history.replaceState({}, '', '/web/geek/job-recommend')

    assert.deepEqual(seen, [
        'https://www.zhipin.com/web/geek/jobs',
        'https://www.zhipin.com/web/geek/chat',
        'https://www.zhipin.com/web/geek/job-recommend',
    ])
    subscription.dispose()
})

test('shares one history wrapper and restores it after the last subscriber leaves', () => {
    const target = new FakeWindow('https://www.zhipin.com/web/geek/jobs')
    const originalPushState = target.history.pushState
    const first = []
    const second = []
    const left = observeBossRoute(target, href => first.push(href))
    const wrappedPushState = target.history.pushState
    const right = observeBossRoute(target, href => second.push(href))

    assert.equal(target.history.pushState, wrappedPushState)
    target.history.pushState({}, '', '/web/geek/chat')
    assert.equal(first.length, 2)
    assert.equal(second.length, 2)

    left.dispose()
    assert.equal(target.history.pushState, wrappedPushState)
    right.dispose()
    assert.equal(target.history.pushState, originalPushState)
})

test('keeps a fallback provisional and migrates when the preferred container appears later', () => {
    const fallback = {name: 'wrap'}
    const preferred = {name: 'jobs'}
    let preferredVisible = false
    const fakeDocument = {
        body: {name: 'body'},
        querySelector(selector) {
            if (selector === '.job-recommend-result') return preferredVisible ? preferred : null
            if (selector === '#wrap') return fallback
            return null
        },
    }

    const first = findBossMountTarget(fakeDocument, 'https://www.zhipin.com/web/geek/jobs', true)
    assert.equal(first.el, fallback)
    assert.equal(first.provisional, true)
    assert.equal(shouldRecoverBossMount(true, true, false), true)

    preferredVisible = true
    const next = findBossMountTarget(fakeDocument, 'https://www.zhipin.com/web/geek/jobs')
    assert.equal(next.el, preferred)
    assert.equal(next.provisional, undefined)
    assert.equal(shouldRecoverBossMount(true, false, false), false)
})
