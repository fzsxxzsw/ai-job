export type BossRiskSignal = {
    reason: string,
    status?: number,
    code?: number,
}

export type BossRiskStopState = BossRiskSignal & {
    triggeredAt: number,
}

const BOSS_RISK_STOP_KEY = 'ai-job-hunting-boss-risk-stop-v1'
const RESTRICTED_TEXT_PATTERN = /(访问受限|账户存在异常|账号存在异常|IP\s*存在异常|IP\s*异常|异常行为|暂时被限制访问|限制访问|请勿频繁提交刷新请求|请求过于频繁|操作过于频繁|too\s*many\s*requests|rate\s*limit|安全验证|验证码)/i

let memoryStop: BossRiskStopState | null = null

const toFiniteNumber = (value: unknown): number | undefined => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

const collectRiskText = (value: any): string => [
    typeof value === 'string' ? value : '',
    value?.message,
    value?.statusText,
    value?.data?.message,
    value?.data?.msg,
    value?.data?.zpData?.message,
    value?.response?.statusText,
    value?.response?.data?.message,
    value?.response?.data?.msg,
    value?.response?.data?.zpData?.message,
    value?.response?.data?.zpData?.bizData?.chatRemindDialog?.content,
].filter(item => typeof item === 'string' && item.trim()).join(' | ')

/**
 * 纯判定函数：只识别 BOSS 明确返回的安全限制，不推测普通业务失败。
 */
export function detectBossRiskSignal(value: unknown): BossRiskSignal | null {
    const input = value as any
    const status = toFiniteNumber(input?.response?.status ?? input?.status)
    if (status === 403 || status === 429) {
        return {reason: `BOSS HTTP ${status} 安全限制`, status}
    }

    const code = toFiniteNumber(
        input?.response?.data?.code
        ?? input?.data?.code
        ?? input?.code,
    )
    if (code === 32) {
        return {reason: 'BOSS code=32 访问限制', code}
    }

    const text = collectRiskText(input)
    if (RESTRICTED_TEXT_PATTERN.test(text)) {
        return {reason: `BOSS 安全限制：${text.slice(0, 160)}`}
    }
    return null
}

const readStoredStop = (): BossRiskStopState | null => {
    try {
        if (typeof localStorage === 'undefined') return null
        const parsed = JSON.parse(localStorage.getItem(BOSS_RISK_STOP_KEY) || 'null')
        return parsed?.reason && Number.isFinite(Number(parsed?.triggeredAt))
            ? parsed as BossRiskStopState
            : null
    } catch (_) {
        return null
    }
}

export function getBossRiskStop(): BossRiskStopState | null {
    return memoryStop || readStoredStop()
}

/**
 * 熔断状态持久化在同源 localStorage，使同一浏览器内的 BOSS 标签页都停止副作用。
 * 不自动清除、不换 IP、不尝试绕过验证；恢复后必须由用户明确处理。
 */
export function tripBossRiskCircuit(value: unknown): BossRiskStopState | null {
    const signal = detectBossRiskSignal(value)
    if (!signal) return null
    const state: BossRiskStopState = {...signal, triggeredAt: Date.now()}
    memoryStop = state
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BOSS_RISK_STOP_KEY, JSON.stringify(state))
        }
    } catch (_) {
        // 内存熔断仍然有效；存储失败不能触发任何重试或降级绕过。
    }
    return state
}

/**
 * 仅供用户在 BOSS 官方页面确认账号已经恢复后手动解除本地熔断。
 * 此函数只清除熔断标记，不启动投递、不打开 AI 回复，也不处理待发送队列。
 */
export function clearBossRiskCircuit(): boolean {
    memoryStop = null
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(BOSS_RISK_STOP_KEY)
        }
    } catch (_) {
        return false
    }
    return getBossRiskStop() === null
}
