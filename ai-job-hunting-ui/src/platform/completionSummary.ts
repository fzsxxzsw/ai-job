type RunSummary = {contacted: number; waitingGreeting: number; uncertainGreeting: number}

type CompletionDependencies = {
    enabled(): Promise<boolean>
    summary(runId: string): Promise<RunSummary>
    notify(message: string, type: 'info' | 'success', duration: number): void
}

/** Report the finished scan without keeping the delivery run active. */
export function announcePushRunCompletion(runId: string, dependencies: CompletionDependencies): void {
    void (async () => {
        try {
            if (await dependencies.enabled()) {
                const summary = await dependencies.summary(runId)
                dependencies.notify(`本轮岗位检查结束：已联系 ${summary.contacted}，待发招呼 ${summary.waitingGreeting}，招呼待核实 ${summary.uncertainGreeting}。分项任务继续显示。`, 'info', 5000)
            } else dependencies.notify('批量投递完成', 'success', 3000)
        } catch { dependencies.notify('本轮岗位检查结束，最新沟通与招呼结果请查看分项任务', 'info', 5000) }
    })()
}
