export type ConnectionStatus = 'checking' | 'online' | 'offline'
export type HealthState = {status: ConnectionStatus, isChecking: boolean, lastError: string, lastCheckedAt: number}
export const HEALTH_TIMEOUT_MS = 5_000
export const HEALTH_POLL_MS = 15_000
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:9100/'

export function normalizeServerUrl(value: string): string {
    const parsed = new URL(value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('服务器地址仅支持不含账号密码的 http 或 https 地址')
    }
    parsed.search = ''; parsed.hash = ''
    parsed.pathname = parsed.pathname.replace(/\/*$/, '/')
    return parsed.toString()
}

export function connectionPresentation(status: ConnectionStatus) {
    if (status === 'online') return {label: '在线', type: 'success' as const, detail: '服务器已连接'}
    if (status === 'checking') return {label: '检查中', type: 'info' as const, detail: '正在检查本地服务…'}
    return {label: '离线', type: 'warning' as const, detail: '服务未连接 · 每15秒自动重试'}
}

type Options = {
    getUrl: () => string
    onChange: (state: HealthState) => void
    fetcher?: typeof fetch
    timeoutMs?: number
    pollMs?: number
    canPoll?: () => boolean
}

/** Owns only read-only health GETs; never logs in, reloads a page or runs a job. */
export function createHealthMonitor(options: Options) {
    const state: HealthState = {status: 'checking', isChecking: false, lastError: '', lastCheckedAt: 0}
    let generation = 0
    let active: {url: string, promise: Promise<boolean>, cancel: () => void} | null = null
    let polling = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    const publish = (patch: Partial<HealthState>) => {
        Object.assign(state, patch)
        options.onChange({...state})
    }
    const schedule = () => {
        if (!polling) return
        if (pollTimer !== null) clearTimeout(pollTimer)
        pollTimer = setTimeout(() => {
            pollTimer = null
            if (options.canPoll?.() === false) schedule()
            else void check(false)
        }, options.pollMs ?? HEALTH_POLL_MS)
    }
    function invalidate() {
        generation++
        active?.cancel()
        active = null
        publish({status: 'checking', isChecking: false, lastError: '', lastCheckedAt: 0})
    }
    function check(foreground = true): Promise<boolean> {
        const url = options.getUrl()
        if (active?.url === url) return active.promise
        if (active) invalidate()
        const ticket = ++generation
        const controller = new AbortController()
        let rejectDeadline: (error: Error) => void = () => {}
        const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject })
        const timeout = setTimeout(() => {
            controller.abort()
            rejectDeadline(new Error('连接超时，请确认 Docker 和本地服务已启动'))
        }, options.timeoutMs ?? HEALTH_TIMEOUT_MS)
        publish({isChecking: true, ...(foreground || state.lastCheckedAt === 0 ? {status: 'checking' as const} : {})})
        const task = (async () => {
            try {
                await Promise.race([deadline, (async () => {
                    const response = await (options.fetcher ?? fetch)(new URL('actuator/health', url), {
                        method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal,
                    })
                    if (!response.ok) throw new Error(`本地服务检查失败（HTTP ${response.status}）`)
                    const body = await response.json()
                    if (body?.status !== 'UP') throw new Error('服务尚未就绪，请稍后重试')
                })()])
                if (ticket !== generation || url !== options.getUrl()) return false
                publish({status: 'online', isChecking: false, lastError: '', lastCheckedAt: Date.now()})
                return true
            } catch (error) {
                if (ticket !== generation || url !== options.getUrl()) return false
                const message = error instanceof Error && error.message.startsWith('连接超时') ? error.message
                    : error instanceof TypeError ? '无法访问本地服务，请确认 Docker 已启动；若浏览器提示本地网络权限，请检查该权限'
                    : error instanceof Error ? error.message : '本地服务检查失败'
                publish({status: 'offline', isChecking: false, lastError: message, lastCheckedAt: Date.now()})
                return false
            } finally {
                clearTimeout(timeout)
                if (ticket === generation) { active = null; schedule() }
            }
        })()
        active = {url, promise: task, cancel: () => {controller.abort(); rejectDeadline(new Error('检查已取消'))}}
        return task
    }
    function start() {
        if (polling) return
        polling = true
        void check(false)
    }
    function stop() {
        polling = false
        if (pollTimer !== null) clearTimeout(pollTimer)
        pollTimer = null
        generation++
        active?.cancel(); active = null
        publish({isChecking: false})
    }
    return {check, start, stop, invalidate, getState: () => ({...state})}
}
