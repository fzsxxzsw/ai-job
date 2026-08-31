import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'ai-job-hunting-loader.user.js')
const loaderSource = readFileSync(scriptPath, 'utf8')

function runLoader(requestHandler, initialPageWindow = {}) {
    const pageWindow = {...initialPageWindow}
    const timers = []
    const notifications = []
    const quietConsole = {info() {}, warn() {}, error() {}}
    const context = {
        console: quietConsole,
        document: {
            getElementById() {
                return pageWindow.__TEST_ROOT__ || null
            },
        },
        GM_info: {script: {version: '0.0.61-local'}},
        GM_notification(options) {
            notifications.push(options)
        },
        GM_xmlhttpRequest(options) {
            requestHandler(options)
        },
        unsafeWindow: pageWindow,
        window: {
            clearTimeout() {},
            setTimeout(callback, delay) {
                timers.push({callback, delay})
                return timers.length
            },
        },
    }
    vm.runInNewContext(loaderSource, context, {filename: scriptPath})
    return {pageWindow, timers, notifications}
}

test('reports running only after the runtime publishes a completed mount', () => {
    const result = runLoader(options => {
        options.onload({
            status: 200,
            responseText: `unsafeWindow.__AI_JOB_HELPER_RUNTIME_STATUS__ = {
                state: 'running', version: '0.0.61-local', buildId: 'test-build', runId: 'run-1'
            };
            unsafeWindow.__AI_JOB_HELPER_ACTIVE_INSTANCE_V1__ = {runId: 'run-1', updatedAt: Date.now()};
            unsafeWindow.__TEST_ROOT__ = {isConnected: true, dataset: {aiJobHelperRunId: 'run-1'}};`,
        })
    })

    const state = result.pageWindow.__AI_JOB_HELPER_LOCAL_LOADER_V1__
    assert.equal(state.state, 'running')
    assert.equal(state.runtimeVersion, '0.0.61-local')
    assert.equal(state.buildId, 'test-build')
})

test('keeps the loader bootstrapping when eval succeeds without a mount handshake', () => {
    const result = runLoader(options => {
        options.onload({status: 200, responseText: 'void 0;'})
    })

    const state = result.pageWindow.__AI_JOB_HELPER_LOCAL_LOADER_V1__
    assert.equal(state.state, 'bootstrapping')
    assert.equal(result.timers.length, 1)
    assert.equal(result.timers[0].delay, 500)
})

test('uses bounded automatic retry after a local runtime download failure', () => {
    const result = runLoader(options => {
        options.onerror({statusText: 'connection refused'})
    })

    const state = result.pageWindow.__AI_JOB_HELPER_LOCAL_LOADER_V1__
    assert.equal(state.state, 'waiting-retry')
    assert.equal(state.failures, 1)
    assert.equal(result.timers.length, 1)
    assert.equal(result.timers[0].delay, 1500)
    assert.equal(result.notifications.length, 1)
})

test('does not treat a connected root from a failed runtime as ready', () => {
    const result = runLoader(options => {
        options.onload({
            status: 200,
            responseText: `unsafeWindow.__AI_JOB_HELPER_RUNTIME_STATUS__ = {
                state: 'failed', runId: 'failed-run', lastError: 'mount failed'
            };
            unsafeWindow.__TEST_ROOT__ = {
                isConnected: true,
                dataset: {aiJobHelperRunId: 'failed-run'},
                remove() { this.isConnected = false; }
            };`,
        })
    })

    assert.equal(result.pageWindow.__AI_JOB_HELPER_LOCAL_LOADER_V1__.state, 'waiting-retry')
})

test('releases an expired owner lock before retrying the local runtime', () => {
    let requested = 0
    const result = runLoader(options => {
        requested++
        options.onerror({statusText: 'offline'})
    }, {
        __AI_JOB_HELPER_ACTIVE_INSTANCE_V1__: {
            runId: 'stale-run',
            state: 'bootstrapping',
            startedAt: Date.now() - 120_000,
            updatedAt: Date.now() - 120_000,
        },
        __AI_JOB_HELPER_RUNTIME_STATUS__: {
            runId: 'stale-run',
            state: 'bootstrapping',
            updatedAt: Date.now() - 120_000,
        },
    })

    assert.equal(requested, 1)
    assert.equal(result.pageWindow.__AI_JOB_HELPER_ACTIVE_INSTANCE_V1__, undefined)
    assert.equal(result.pageWindow.__AI_JOB_HELPER_LOCAL_LOADER_V1__.state, 'waiting-retry')
})
