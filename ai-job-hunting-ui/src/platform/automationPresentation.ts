import type {AutomationAction, AutomationJob, AutomationStatus} from './unifiedAutomation'

export function automationPhaseLabel(value: string): string {
    return ({QUEUED: '等待 LangGraph 领取', COLLECTING: '收集资料', COMPUTING: '分析与决策', ANALYZING: '分析',
        VALIDATING: '校验', SAVING: '保存', PERSISTING: '保存', WAITING_EXECUTION: '等待浏览器执行',
        WAITING_CONFIRMATION: '等待你确认', FINALIZING: '核对分项回执', COMPLETED: '任务已结束', FAILED: '任务失败',
        UNCERTAIN: '结果待核实', SUPERSEDED: '已由新消息替代', CANCELLED: '已取消', RETRY: '等待重试'} as Record<string, string>)[value] || value
}
export function automationJobLabel(job: AutomationJob): string {
    if (job.status === 'READY') return '等待 LangGraph 领取'
    if (job.status === 'UNCERTAIN') return '平台结果待核实，不会重发'
    if (job.status === 'FAILED') return '任务失败，请查看分项结果'
    if (job.status === 'RETRY') return '依赖暂不可用，等待任务重试'
    if (job.status === 'COMPLETED') {
        if (job.decision?.code === 'MISSING_MATERIALS') return '资料不足，本轮未发送'
        if (!job.actions.length) return '决策已完成，本轮无需发送'
        if (job.actions.some(action => action.approvalStatus === 'DECLINED')) return '任务结束；已拒绝的动作没有发送'
        return '任务结束；发送结果以分项回执为准'
    }
    return automationPhaseLabel(job.phase)
}
export function automationActionLabel(action: AutomationAction): string {
    const name = ({CONTACT_JOB: '发起沟通', SEND_GREETING: '招呼语', SEND_TEXT: '文本回复', SEND_RESUME: '发送附件简历',
        ACCEPT_PHONE: '同意交换电话', ACCEPT_WECHAT: '同意交换微信', ACCEPT_RESUME: '同意附件简历请求'} as Record<string, string>)[action.kind]
    const status = action.approvalStatus === 'DECLINED' ? '你已拒绝，未发送' : ({QUEUED: '待执行', LEASED: '已领取，尚未发出',
        DISPATCHING: '已派发，等待回执', ACKNOWLEDGED: '平台已确认', FAILED: '失败', CANCELLED: '已取消', UNKNOWN: '待核实，不会重发'} as Record<string, string>)[action.status] || action.status
    return `${name}：${status}`
}
export function outcomeSubscriptionLabel(status: AutomationStatus | null, observationSyncedAt: number, error: string): string {
    if (error || !status) return '连接尚未确认'
    if (!status.outcomes.enabled) return '自动分析未启用'
    if (status.agent.state !== 'READY') return '分析工作进程未就绪'
    return observationSyncedAt ? '观察后台已连接' : '等待首次观察同步'
}
