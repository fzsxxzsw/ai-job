/**
 * 固定、透明的安全节流参数。它们用于减少请求频率，不做随机化或反检测。
 */
export const SAFE_MIN_PUSH_INTERVAL_SECONDS = 3
export const SAFE_DEFAULT_PUSH_INTERVAL_SECONDS = 15
export const SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS = 90
export const SAFE_DEFAULT_NEXT_PAGE_INTERVAL_SECONDS = 120
export const BOSS_LAST_PUSH_AT_KEY = 'boss_last_push_at'

/**
 * Calculate the remaining global cooldown without delaying the first application
 * in a fresh profile. A configured value above the minimum remains respected.
 */
export function calculatePushCooldownMs(
    lastPushAt: number,
    configuredSeconds: number,
    now: number = Date.now(),
): number {
    if (!Number.isFinite(lastPushAt) || lastPushAt <= 0) return 0

    const intervalSeconds = Math.max(
        SAFE_MIN_PUSH_INTERVAL_SECONDS,
        Number(configuredSeconds) || SAFE_DEFAULT_PUSH_INTERVAL_SECONDS,
    )
    const elapsedMs = Math.max(0, now - lastPushAt)
    return Math.max(0, intervalSeconds * 1000 - elapsedMs)
}
