import {createApp} from 'vue';
import './style.css';
import 'element-plus/dist/index.css'
import PlatformFactory, {Platform} from "./platform/platform";
import App from './App.vue';
import logger, {Logger, LogLevel} from "./logging";
import {createPinia, setActivePinia} from 'pinia'
import axios from "./axios";
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import {isProdEnv} from "./utils/tools";
import {GM_info, unsafeWindow} from "$";
import {observeBossRoute, RouteHostWindow, shouldRecoverBossMount} from "./runtime/routeHost";
import {installBossJobSearchCapture} from "./platform/boss/jobSourceAdapter";

import {ServerStore} from "./stores/server";

const INSTANCE_LOCK_KEY = '__AI_JOB_HELPER_ACTIVE_INSTANCE_V1__'
const RUNTIME_STATUS_KEY = '__AI_JOB_HELPER_RUNTIME_STATUS__'
const RUNTIME_STATE_EVENT = 'ai-job-helper:runtime-state'
const sharedWindow = unsafeWindow as any
const runtimeRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
let runtimeStatus: Record<string, any> | null = null
let cleanupFailedRuntime: (() => void) | null = null

function publishRuntimeStatus(patch: Record<string, any>) {
    const updatedAt = Date.now()
    runtimeStatus = Object.assign(runtimeStatus || {}, patch, {updatedAt})
    sharedWindow[RUNTIME_STATUS_KEY] = runtimeStatus
    const instanceLock = sharedWindow[INSTANCE_LOCK_KEY]
    if (instanceLock?.runId === runtimeRunId) {
        instanceLock.state = runtimeStatus.state
        instanceLock.updatedAt = updatedAt
    }
    try {
        sharedWindow.dispatchEvent(new sharedWindow.CustomEvent(RUNTIME_STATE_EVENT, {
            detail: {...runtimeStatus},
        }))
    } catch (_) {
        // The stable loader also polls the shared status, so an event failure is harmless.
    }
}

function runtimeErrorMessage(error: unknown): string {
    return String((error as any)?.message || error || '未知错误').slice(0, 500)
}

async function waitForDocumentReady(): Promise<void> {
    if (document.readyState !== 'loading') return
    await new Promise<void>(resolve => {
        document.addEventListener('DOMContentLoaded', () => resolve(), {once: true})
    })
}

async function bootstrap() {
    const loaderVersion = GM_info?.script?.version || '未知版本'
    const runtimeVersion = typeof __AI_JOB_HELPER_RUNTIME_VERSION__ !== 'undefined'
        ? __AI_JOB_HELPER_RUNTIME_VERSION__
        : loaderVersion
    const buildId = typeof __AI_JOB_HELPER_BUILD_ID__ !== 'undefined'
        ? __AI_JOB_HELPER_BUILD_ID__
        : '未知构建'
    logger.info(`AI工作猎手启动，运行代码版本：${runtimeVersion}，构建：${buildId}，启动器版本：${loaderVersion}`)
    publishRuntimeStatus({
        version: runtimeVersion,
        buildId,
        loaderVersion,
        runId: runtimeRunId,
        state: 'bootstrapping',
        startedAt: Date.now(),
        lastError: '',
    })
    // Capture the structured search response before the UI starts reading job
    // cards. DOM/Vue extraction remains available as a compatibility fallback.
    installBossJobSearchCapture(sharedWindow)
    const app = createApp(App);
    const pinia = createPinia()
    // WebSocket may receive a message immediately at document-start. Make Pinia
    // available before loading the hook so the first HR message can read config.
    setActivePinia(pinia)
    // 不在模块顶层加载 websocket hook，确保重复脚本在产生任何副作用前就被实例锁拦截。
    await import('./webSocket/hookMain')
    if (!isProdEnv()) {
        Logger.setGlobalLogLevel(LogLevel.Debug)
    }
    app.use(pinia)

    // 初始化服务器检查
    const serverStore = ServerStore(pinia)
    serverStore.checkConnection()

    // 使用本地化语言包(主要是运行记录中时间筛选组件显示中文)
    app.use(ElementPlus, {
        locale: zhCn,
    })

    // 创建平台
    const platform: Platform = PlatformFactory.getInstance(location.href);
    app.provide('$platform', platform)
    app.provide('$axios', axios)

    // 挂载
    const rootApp = document.createElement('div');
    rootApp.id = "ai-job"
    rootApp.dataset.aiJobHelperRunId = runtimeRunId
    rootApp.classList.add('page-job-content');

    let mounted = false
    let placementVersion = 0
    let placementTask: Promise<void> | null = null
    let placementRetryTimer: number | null = null
    let placementFailureCount = 0
    let placementIsProvisional = false

    cleanupFailedRuntime = () => {
        if (placementRetryTimer != null) window.clearTimeout(placementRetryTimer)
        try {
            if (mounted) app.unmount()
        } catch (_) {
            // The root is removed below even if Vue already detached itself.
        }
        rootApp.remove()
    }

    const placeRoot = (): Promise<void> => {
        if (placementTask) return placementTask
        const task = (async () => {
            // A route can change while getMountEle() is waiting for BOSS to
            // render. Discard the stale result and resolve again for the newest
            // route without running concurrent mount searches.
            while (true) {
                const expectedVersion = placementVersion
                const elP = await platform.getMountEle()
                if (expectedVersion !== placementVersion) continue
                const containerEle = elP.el
                if (!containerEle.isConnected) continue
                if (elP.p === "end") {
                    containerEle.appendChild(rootApp)
                } else {
                    containerEle.insertBefore(rootApp, containerEle.firstElementChild)
                }
                if (!rootApp.isConnected) {
                    throw new Error('页面挂载容器已失效')
                }
                placementFailureCount = 0
                placementIsProvisional = Boolean(elP.provisional)
                if (placementIsProvisional) {
                    publishRuntimeStatus({
                        state: 'recovering',
                        mountTarget: containerEle.tagName,
                        lastError: '等待 BOSS 页面的正式挂载位置',
                        nextMountRetryAt: Date.now() + 2_000,
                    })
                } else {
                    publishRuntimeStatus({
                        state: 'running',
                        mountedAt: Date.now(),
                        mountTarget: containerEle.tagName,
                        lastError: '',
                        nextMountRetryAt: 0,
                    })
                }
                break
            }
        })()
        placementTask = task
        task.then(
            () => {
                if (placementTask === task) placementTask = null
            },
            () => {
                if (placementTask === task) placementTask = null
            },
        )
        return task
    }

    const requestPlacement = () => {
        placementVersion++
        void placeRoot().catch(error => {
            placementFailureCount++
            const retryDelay = Math.min(15_000, 1_000 * 2 ** Math.min(placementFailureCount - 1, 4))
            publishRuntimeStatus({
                state: 'recovering',
                lastError: `界面重新挂载失败：${runtimeErrorMessage(error)}`,
                nextMountRetryAt: Date.now() + retryDelay,
            })
            logger.error(`AI工作猎手重新挂载失败，${retryDelay / 1000} 秒后重试`, error)
            if (placementRetryTimer != null) window.clearTimeout(placementRetryTimer)
            placementRetryTimer = window.setTimeout(() => {
                placementRetryTimer = null
                requestPlacement()
            }, retryDelay)
        })
    }

    const mountApp = async () => {
        const existing = document.getElementById(rootApp.id)
        if (existing && existing !== rootApp) {
            // Reaching bootstrap means this instance owns the page lock. A root
            // left behind by an older failed runtime is therefore stale.
            existing.remove()
            logger.warn('已清理上一轮未完成启动遗留的AI工作猎手根节点')
        }
        if (!mounted) {
            app.mount(rootApp)
            mounted = true
        }

        platform.curUrl = String(location.href)
        placementVersion++
        await placeRoot()

        let initialRouteNotification = true
        observeBossRoute(window as unknown as RouteHostWindow, href => {
            platform.curUrl = href
            if (initialRouteNotification) {
                initialRouteNotification = false
                return
            }
            requestPlacement()
        })

        // BOSS mutates a large DOM tree continuously. A subtree-wide observer
        // would run on nearly every card/chat update; a lightweight watchdog is
        // enough because route changes already trigger immediate placement.
        window.setInterval(() => {
            if (shouldRecoverBossMount(rootApp.isConnected, placementIsProvisional, Boolean(placementTask))) {
                requestPlacement()
            }
        }, 2_000)
    }

    // Await the first real DOM mount. The stable loader must not report
    // "running" merely because the bundle was evaluated successfully.
    await waitForDocumentReady()
    await mountApp()
}

if (sharedWindow[INSTANCE_LOCK_KEY]) {
    logger.warn('检测到另一套AI工作猎手脚本，本实例已停止，避免重复投递和重复发送招呼语')
} else {
    // 两个脚本即使在同一毫秒启动，也会同步竞争同一个页面级锁，只有第一个可以继续。
    sharedWindow[INSTANCE_LOCK_KEY] = {
        runId: runtimeRunId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        state: 'bootstrapping',
    }
    bootstrap().catch(error => {
        cleanupFailedRuntime?.()
        publishRuntimeStatus({
            state: 'failed',
            failedAt: Date.now(),
            lastError: runtimeErrorMessage(error),
        })
        if (sharedWindow[INSTANCE_LOCK_KEY]?.runId === runtimeRunId) {
            delete sharedWindow[INSTANCE_LOCK_KEY]
        }
        logger.error('AI工作猎手初始化失败', error)
    })
}

