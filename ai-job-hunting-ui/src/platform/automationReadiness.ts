export type DeliveryRunState = {
    isActive: boolean
    status: string
    stopRequested: boolean
}

/**
 * LangGraph can finish computing the last CONTACT_JOB just after the page scan
 * reaches its end.  A normally completed scan still authorizes those actions;
 * an explicit stop, block or failure does not.
 */
export function deliveryRunAuthorized(
    run: DeliveryRunState,
    continuationStopped: boolean,
    riskStopped: boolean,
): boolean {
    return (run.isActive || run.status === 'completed')
        && !continuationStopped
        && !run.stopRequested
        && !riskStopped
}
