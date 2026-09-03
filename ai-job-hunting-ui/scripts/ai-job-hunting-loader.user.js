// ==UserScript==
// @name         AI工作猎手-本地个人版
// @namespace    https://github.com/yangfeng20
// @version      0.0.62-local
// @author       maple.
// @description  AI工作猎手本地启动器：从本机加载自包含运行代码，不依赖公共CDN。
// @license      Apache License 2.0
// @icon         https://gitee.com/yangfeng20/ai-job/raw/master/file/icon.png
// @downloadURL  http://127.0.0.1:5173/ai-job-hunting-local.user.js
// @updateURL    http://127.0.0.1:5173/ai-job-hunting-local.user.js
// @match        https://www.zhipin.com/web/geek/*
// @match        https://www.zhipin.com/overseas/*
// @connect      docdownload.zhipin.com
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function loadLatestLocalRuntime() {
    'use strict';

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const loaderKey = '__AI_JOB_HELPER_LOCAL_LOADER_V1__';
    const runtimeStatusKey = '__AI_JOB_HELPER_RUNTIME_STATUS__';
    const instanceLockKey = '__AI_JOB_HELPER_ACTIVE_INSTANCE_V1__';
    const loaderVersion = GM_info?.script?.version || '0.0.62-local';
    const previousState = pageWindow[loaderKey];
    const previousLock = pageWindow[instanceLockKey];
    const previousRuntime = pageWindow[runtimeStatusKey];
    const previousRoot = document.getElementById('ai-job');
    const previousReady = previousRuntime?.state === 'running'
        && Boolean(previousRuntime?.runId)
        && previousLock?.runId === previousRuntime.runId
        && previousRoot?.isConnected
        && previousRoot?.dataset?.aiJobHelperRunId === previousRuntime.runId;
    const previousHeartbeatAt = Math.max(
        Number(previousState?.startedAt || 0),
        Number(previousLock?.updatedAt || 0),
        Number(previousRuntime?.updatedAt || 0),
    );
    const previousAttemptIsFresh = Date.now() - previousHeartbeatAt < 90_000;
    if (previousState?.loaderVersion === loaderVersion
        && (previousReady || (previousAttemptIsFresh
            && ['loading', 'bootstrapping', 'recovering', 'waiting-retry'].includes(previousState.state)))) {
        return;
    }

    const loaderState = pageWindow[loaderKey] = {
        loaderVersion,
        startedAt: Date.now(),
        state: 'idle',
        attempts: 0,
        failures: 0,
    };
    const retryDelays = [1500, 4000, 10_000, 15_000];
    const bootstrapTimeoutMs = 30_000;
    const staleInstanceTimeoutMs = 90_000;
    let retryTimer = 0;
    let readinessTimer = 0;
    let requestInFlight = false;

    const errorText = (error) => String(error?.message || error?.error || error?.statusText || error || '未知错误').slice(0, 500);
    const notifyFailure = (message) => {
        try {
            GM_notification({
                title: 'AI工作猎手正在自动恢复',
                text: `${message}；启动器会继续自动重试，无需重复点击脚本。`,
                timeout: 8000,
            });
        } catch (_) {
            // 通知不可用时保留控制台诊断即可。
        }
    };

    const markRunning = (runtimeStatus) => {
        window.clearTimeout(retryTimer);
        window.clearTimeout(readinessTimer);
        loaderState.state = 'running';
        loaderState.readyAt = Date.now();
        loaderState.runtimeVersion = runtimeStatus?.version || '未知版本';
        loaderState.buildId = runtimeStatus?.buildId || '未知构建';
        loaderState.error = '';
        console.info('[AI工作猎手] 本地运行代码已完成挂载', loaderState);
    };

    const readyRuntime = () => {
        const runtimeStatus = pageWindow[runtimeStatusKey];
        const instanceLock = pageWindow[instanceLockKey];
        const root = document.getElementById('ai-job');
        return runtimeStatus?.state === 'running'
            && Boolean(runtimeStatus?.runId)
            && instanceLock?.runId === runtimeStatus.runId
            && root?.isConnected
            && root?.dataset?.aiJobHelperRunId === runtimeStatus.runId
            ? runtimeStatus
            : null;
    };

    const releaseStaleInstance = () => {
        const instanceLock = pageWindow[instanceLockKey];
        if (!instanceLock) return false;
        const root = document.getElementById('ai-job');
        const heartbeatAt = Math.max(
            Number(instanceLock.updatedAt || instanceLock.startedAt || 0),
            Number(pageWindow[runtimeStatusKey]?.updatedAt || 0),
        );
        if (root?.isConnected || Date.now() - heartbeatAt < staleInstanceTimeoutMs) return false;
        if (pageWindow[instanceLockKey] === instanceLock) delete pageWindow[instanceLockKey];
        return true;
    };

    const scheduleRetry = (reason) => {
        requestInFlight = false;
        window.clearTimeout(readinessTimer);
        loaderState.failures += 1;
        loaderState.error = errorText(reason);
        const delay = retryDelays[Math.min(loaderState.failures - 1, retryDelays.length - 1)];
        loaderState.state = 'waiting-retry';
        loaderState.nextRetryAt = Date.now() + delay;
        console.error(`[AI工作猎手] 启动失败，${delay / 1000} 秒后自动重试：`, loaderState.error);
        if (loaderState.failures === 1 || loaderState.failures % 16 === 0) {
            notifyFailure(loaderState.error);
        }
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(attemptLoad, delay);
    };

    const inspectRuntime = (evaluatedAt) => {
        const runtimeStatus = pageWindow[runtimeStatusKey];
        const readyStatus = readyRuntime();
        if (readyStatus) {
            markRunning(readyStatus);
            return;
        }
        if (runtimeStatus?.state === 'failed' && !pageWindow[instanceLockKey]) {
            scheduleRetry(`运行代码初始化失败：${runtimeStatus.lastError || '未知错误'}`);
            return;
        }
        if (Date.now() - evaluatedAt >= bootstrapTimeoutMs) {
            if (releaseStaleInstance()) {
                scheduleRetry('运行代码的启动锁已超时，正在重新初始化');
                return;
            }
            if (!pageWindow[instanceLockKey]) {
                const staleRoot = document.getElementById('ai-job');
                if (staleRoot?.dataset?.aiJobHelperRunId === runtimeStatus?.runId) staleRoot.remove();
                scheduleRetry('运行代码在 30 秒内未完成启动');
                return;
            }
            // An active instance owns the page and is retrying its mount target.
            // Keep observing it instead of evaluating a duplicate runtime.
            loaderState.state = 'recovering';
            loaderState.error = runtimeStatus?.lastError || '界面仍在等待页面挂载点';
        }
        const checkDelay = Date.now() - evaluatedAt >= bootstrapTimeoutMs ? 2_000 : 500;
        readinessTimer = window.setTimeout(() => inspectRuntime(evaluatedAt), checkDelay);
    };

    function attemptLoad() {
        if (requestInFlight) return;
        const runtimeStatus = pageWindow[runtimeStatusKey];
        const readyStatus = readyRuntime();
        if (readyStatus) {
            markRunning(readyStatus);
            return;
        }
        releaseStaleInstance();
        if (pageWindow[instanceLockKey]
            && ['bootstrapping', 'recovering'].includes(runtimeStatus?.state)) {
            loaderState.state = runtimeStatus.state;
            inspectRuntime(Number(runtimeStatus.startedAt || Date.now()));
            return;
        }

        requestInFlight = true;
        loaderState.attempts += 1;
        loaderState.state = 'loading';
        loaderState.error = '';
        const runtimeUrl = `http://127.0.0.1:5173/ai-job-hunting-runtime.js?t=${Date.now()}`;
        loaderState.runtimeUrl = runtimeUrl;

        GM_xmlhttpRequest({
            method: 'GET',
            url: runtimeUrl,
            timeout: 15_000,
            headers: {'Cache-Control': 'no-cache'},
            onload(response) {
                requestInFlight = false;
                if (response.status < 200 || response.status >= 300 || !response.responseText) {
                    scheduleRetry(`运行代码下载失败：HTTP ${response.status}`);
                    return;
                }
                try {
                    loaderState.runtimeBytes = response.responseText.length;
                    loaderState.loadedAt = Date.now();
                    loaderState.state = 'bootstrapping';
                    // Direct eval preserves access to the userscript manager's GM_* APIs.
                    eval(`${response.responseText}\n//# sourceURL=ai-job-hunting-runtime.js`);
                    inspectRuntime(loaderState.loadedAt);
                } catch (error) {
                    scheduleRetry(`运行代码执行失败：${errorText(error?.stack || error)}`);
                }
            },
            ontimeout() {
                scheduleRetry('连接本地前端超时');
            },
            onerror(error) {
                scheduleRetry(`连接本地前端失败：${errorText(error)}`);
            },
        });
    }

    attemptLoad();
})();
