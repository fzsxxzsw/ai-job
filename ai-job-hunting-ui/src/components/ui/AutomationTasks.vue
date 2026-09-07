<template>
    <section class="automation-tasks" aria-label="LangGraph 自动化任务">
        <div class="task-heading"><strong>LangGraph 自动化任务</strong>
            <el-tag size="small">{{ state.status ? (state.status.enabled ? '统一编排已启用' : '当前为兼容模式') : '等待状态确认' }}</el-tag>
        </div>
        <p v-if="state.error" class="task-warning" role="status">{{ state.error }}</p>
        <template v-if="state.status">
            <p>分析工作进程：{{ workerLabel(state.status.agent.state) }} · 浏览器执行器：{{ workerLabel(state.status.executor.state) }}</p>
            <p>回复／投递／复盘：排队 {{ state.status.counts.queued }} · 处理中 {{ state.status.counts.running }} · 等待执行 {{ state.status.counts.waitingExecution }} · 等待确认 {{ state.status.counts.waitingConfirmation }} · 待核实 {{ state.status.counts.uncertain }} · 失败 {{ state.status.counts.failed }}</p>
            <small>已结束任务 {{ state.status.counts.completed }}；最近结束 {{ formatTime(state.status.agent.lastCompletedAt) }}。工作进程在线不代表任务已执行。</small>
        </template>
        <p v-if="!state.jobs.length">当前没有回复、投递或复盘任务；投递结果分析任务单独列在下方。</p>
        <section v-if="state.status?.outcomes.tasks" aria-label="投递结果分析任务">
            <strong>投递结果分析 · {{ state.status.outcomes.tasks.total }} 个任务</strong>
            <p>排队 {{ (state.status.outcomes.tasks.counts.READY || 0) + (state.status.outcomes.tasks.counts.RETRY || 0) }} · 处理中 {{ state.status.outcomes.tasks.counts.RUNNING || 0 }} · 等待确认 {{ state.status.outcomes.tasks.counts.WAITING_CONFIRMATION || 0 }} · 反馈后待恢复 {{ state.status.outcomes.tasks.counts.CONFIRMATION_READY || 0 }} · 已完成 {{ state.status.outcomes.tasks.counts.COMPLETED || 0 }} · 失败 {{ state.status.outcomes.tasks.counts.FAILED || 0 }} · 已被替代 {{ state.status.outcomes.tasks.counts.SUPERSEDED || 0 }}</p>
            <small>按已保存的分析任务统计，报告保存后仍需等待确认与任务恢复；下列展示最近 10 个任务。</small>
            <p v-if="!state.status.outcomes.tasks.total">尚无分析任务；收到可靠且可关联的消息后才会创建。</p>
            <details v-for="task in state.status.outcomes.tasks.items" :key="task.jobId" :open="task.status === 'WAITING_CONFIRMATION'">
                <summary>投递结果分析 · {{ outcomeTaskLabel(task) }} · 第 {{ task.revision }} 版</summary>
                <p>任务 {{ task.jobId }} · 更新于 {{ formatTime(task.updatedAt) }}</p>
                <ol><li v-for="(step, index) in task.phaseHistory" :key="index">{{ outcomePhaseLabel(step.phase) }} · {{ formatTime(step.at) }}</li></ol>
                <p v-if="task.status === 'WAITING_CONFIRMATION'">报告已保存，请在投递结果自动分析卡片中确认、纠正或忽略。</p>
                <p v-if="task.lastErrorCode" class="task-warning">任务未完成：{{ task.lastErrorCode }}<span v-if="task.nextAttemptAt"> · 下次重试 {{ formatTime(task.nextAttemptAt) }}</span></p>
            </details>
        </section>
        <p v-else-if="state.status">分析任务统计尚未提供，请查看投递结果自动分析卡片；不能据此判断没有任务。</p>
        <el-button v-if="pushRun.status === 'completed'" size="small" :disabled="!!busy" @click="stopGreetingContinuation">停止本轮待发招呼</el-button>
        <details v-for="job in state.jobs" :key="job.jobId" :open="job.status === 'WAITING_CONFIRMATION'">
            <summary>{{ kindLabel(job.kind) }} · {{ automationJobLabel(job) }}</summary>
            <el-button v-if="job.actions.some(action => action.status === 'QUEUED' || action.status === 'LEASED')" size="small" :disabled="!!busy" @click="cancelJob(job.jobId)">取消本任务待发动作</el-button>
            <p v-if="job.decision">{{ job.decision.reason }}</p>
            <ol><li v-for="(step, index) in job.phaseHistory" :key="index">{{ automationPhaseLabel(step.phase) }}</li></ol>
            <p v-if="job.lastErrorCode" class="task-warning">{{ job.lastErrorCode === 'INBOUND_ORDER_UNCERTAIN' ? '消息先后顺序缺少可靠时间证明，旧待发动作已暂停；需要核对消息关联。' : job.status === 'UNCERTAIN' ? '平台回执不足，请先核对原动作；不会自动再发。' : '本轮未完整执行，已保留任务与已取得的回执。' }}</p>
            <div v-for="action in job.actions" :key="action.actionId" class="task-action">
                <strong>{{ automationActionLabel(action) }}</strong>
                <p>岗位 {{ action.payload.encryptJobId }}<span v-if="action.payload.bossId"> · 联系人 {{ action.payload.bossId }}</span></p>
                <blockquote v-if="action.payload.text">{{ action.payload.text }}</blockquote>
                <p v-if="action.kind.includes('RESUME')">附件 {{ action.payload.platformResumeId || '尚未确认' }}；内容版本 {{ action.payload.resumeVersionId || '尚无附件内容证明' }}</p>
                <template v-if="action.approvalStatus === 'PENDING'">
                    <p>只批准这一次具体操作，不会开启其他自动发送。</p>
                    <el-button size="small" type="primary" :disabled="!!busy" @click="approve(action, 'APPROVE')">批准本次操作</el-button>
                    <el-button size="small" :disabled="!!busy" @click="approve(action, 'DECLINE')">拒绝本次操作</el-button>
                </template>
            </div>
        </details>
    </section>
</template>
<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue'
import {subscribeUnifiedAutomation, approveAutomationAction, cancelAutomationJob, stopGreetingContinuation} from '../../platform/unifiedRuntime'
import {PushRunStore} from '../../stores/pushRun'
import {automationActionLabel, automationJobLabel, automationPhaseLabel} from '../../platform/automationPresentation'
import {outcomeTaskLabel, outcomePhaseLabel} from '../../extension/outcomesProtocol'
import type {AutomationAction, AutomationSnapshot} from '../../platform/unifiedAutomation'
import {ElMessage} from '../../utils/tools'
const state = ref<AutomationSnapshot>({status: null, jobs: [], error: '', held: 0, updatedAt: 0})
const busy = ref('')
const pushRun = PushRunStore()
let dispose: (() => void) | undefined
const workerLabel = (value: string) => ({READY: '在线', STALE: '心跳已过期', OFFLINE: '离线'} as Record<string, string>)[value] || '未知'
const kindLabel = (value: string) => ({REPLY: '回复', APPLICATION: '筛选与投递', CAREER_REVIEW: '求职复盘'} as Record<string, string>)[value] || '任务'
const formatTime = (value: number | null) => value ? new Date(value).toLocaleString() : '尚无记录'
async function cancelJob(jobId: string) {
    if (busy.value) return
    busy.value = jobId
    try { await cancelAutomationJob(jobId); ElMessage.success('待发动作已取消；已派发动作保留回执核对') }
    catch { ElMessage.warning('取消尚未确认，请查看任务状态') }
    finally { busy.value = '' }
}
async function approve(action: AutomationAction, decision: 'APPROVE' | 'DECLINE') {
    if (busy.value) return
    busy.value = action.actionId
    try { await approveAutomationAction(action, decision); ElMessage.success(decision === 'APPROVE' ? '本次操作已批准，等待授权与执行回执' : '本次操作已拒绝') }
    catch { ElMessage.warning('操作尚未确认，原任务保持等待，请查看连接状态') }
    finally { busy.value = '' }
}
onMounted(() => { dispose = subscribeUnifiedAutomation(value => { state.value = value }) })
onUnmounted(() => dispose?.())
</script>
<style scoped>
.automation-tasks{padding:12px;margin:12px 0;border:1px solid #d6e3df;border-radius:8px;color:#243b33;background:#f8fbfa;font-size:13px}
.task-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.automation-tasks p{margin:8px 0;overflow-wrap:anywhere}
.automation-tasks details{padding:10px 0;border-top:1px solid #d6e3df}.automation-tasks summary{cursor:pointer;font-weight:600}
.automation-tasks ol{display:flex;gap:8px 20px;flex-wrap:wrap}.task-warning{color:#87551a}.task-action{padding:8px;border:1px solid #d6e3df;margin-top:8px;background:white}
.task-action blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:8px;background:#f3f6f5}
</style>
