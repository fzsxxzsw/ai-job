import {deliveryRunAuthorized, type DeliveryRunState} from './automationReadiness.ts'

/** A stop must wake a long page/cooldown wait without shortening a live run's interval. */
export function waitForPushDelay(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    return new Promise(resolve => {
        let settled = false
        let timer: ReturnType<typeof setTimeout>
        const finish = (completed: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            resolve(completed)
        }
        const onAbort = () => finish(false)
        timer = setTimeout(() => finish(true), Math.max(0, ms))
        signal.addEventListener('abort', onAbort, {once: true})
        if (signal.aborted) finish(false)
    })
}

/** Stops waiting for a read-only preflight; its eventual result has no send path. */
export function waitForPushPreflight<T>(pending: Promise<T>, signal: AbortSignal): Promise<{stopped: true} | {stopped: false; value: T}> {
    if (signal.aborted) return Promise.resolve({stopped: true})
    return new Promise((resolve, reject) => {
        let settled = false
        const cleanup = () => signal.removeEventListener('abort', onAbort)
        const onAbort = () => {
            if (settled) return
            settled = true
            cleanup()
            resolve({stopped: true})
        }
        signal.addEventListener('abort', onAbort, {once: true})
        if (signal.aborted) onAbort()
        pending.then(value => {
            if (settled) return
            settled = true
            cleanup()
            resolve({stopped: false, value})
        }, error => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
        })
    })
}

/** Legacy queue records have no run identity and may be reconciled, but never sent. */
export function greetingDispatchAuthorized(
    entry: {runId?: string; account?: string; createdAt: number},
    run: DeliveryRunState,
    account: string,
    continuationStopped: boolean,
    riskStopped: boolean,
    now = Date.now(),
): boolean {
    return !!entry.runId && !!account && entry.runId === run.runId && entry.account === account
        && Number.isFinite(entry.createdAt) && !!run.startedAt && entry.createdAt >= run.startedAt
        && deliveryRunAuthorized(run, continuationStopped, riskStopped, now)
}
