export type DeliveryRunState = {
    isActive: boolean
    status: string
    stopRequested: boolean
    runId?: string
    startedAt?: number
    completedAt?: number
}

export const COMPLETED_DELIVERY_GRACE_MS = 2 * 60_000

/**
 * LangGraph can finish computing the last CONTACT_JOB just after the page scan
 * reaches its end. A normally completed scan has a short same-day window for
 * those actions. The completion timestamp is memory-only; a reload revokes it.
 */
export function deliveryRunAuthorized(
    run: DeliveryRunState,
    continuationStopped: boolean,
    riskStopped: boolean,
    now = Date.now(),
): boolean {
    if (!run.runId || !run.startedAt || !Number.isFinite(run.startedAt) || now < run.startedAt
        || continuationStopped || run.stopRequested || riskStopped) return false
    const started = new Date(run.startedAt)
    const current = new Date(now)
    if (started.getFullYear() !== current.getFullYear() || started.getMonth() !== current.getMonth()
        || started.getDate() !== current.getDate()) return false
    if (run.isActive) return true
    return run.status === 'completed' && !!run.completedAt && Number.isFinite(run.completedAt)
        && now >= run.completedAt && now - run.completedAt <= COMPLETED_DELIVERY_GRACE_MS
}
