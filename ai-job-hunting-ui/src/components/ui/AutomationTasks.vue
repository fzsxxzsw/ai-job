<template>
    <section class="automation-tasks" aria-label="自动求职助手">
        <details class="automation-overview">
            <summary class="automation-summary">
                <strong>自动求职助手</strong>
                <el-tag size="small">{{ state.status?.enabled ? '已启用' : state.status ? '兼容模式' : '正在连接' }}</el-tag>
                <span :class="healthy ? 'summary-ok' : 'summary-warning'">{{ healthLabel }}</span>
                <span v-if="processingCount">处理中 {{ processingCount }}</span>
                <span v-if="actionRequired" class="summary-warning">需你处理 {{ actionRequired }}</span>
                <span class="summary-action"><span class="expand-label">查看详情</span><span class="collapse-label">收起</span></span>
            </summary>
            <div class="automation-details">
                <p v-if="state.error" class="task-warning" role="status">{{ state.error }}</p>
                <template v-if="state.status">
                    <p>{{ healthy ? '分析服务和浏览器执行器均在线。' : '部分服务状态异常，请查看服务器连接。' }}</p>
                    <p>自动分析：已完成 {{ outcomeCompleted }} · 处理中 {{ outcomeProcessing }}<span v-if="outcomeFailed"> · 失败 {{ outcomeFailed }}</span></p>
                    <p>回复与投递：处理中 {{ actionProcessing }}<span v-if="state.status.counts.failed"> · 失败 {{ state.status.counts.failed }}</span></p>
                    <small>分析报告会自动完成并显示在对应会话与求职复盘中，无需逐条确认。</small>
                </template>
                <p v-if="!activeJobs.length && !actionRequired">目前没有需要你处理的任务。</p>
                <el-button v-if="pushRun.status === 'completed'" size="small" :disabled="!!busy" @click="stopGreetingContinuation">停止本轮待发招呼</el-button>
                <details v-for="job in activeJobs" :key="job.jobId" :open="job.status === 'WAITING_CONFIRMATION'">
                    <summary>{{ kindLabel(job.kind) }} · {{ automationJobLabel(job) }}</summary>
                    <el-button v-if="job.actions.some(action => action.status === 'QUEUED' || action.status === 'LEASED')" size="small" :disabled="!!busy" @click="cancelJob(job.jobId)">取消本任务待发动作</el-button>
                    <p v-if="job.decision">{{ job.decision.reason }}</p>
                    <p v-if="job.lastErrorCode" class="task-warning">{{ job.status === 'UNCERTAIN' ? '平台回执不足，请核对原操作。系统不会自动重复发送。' : '任务未完整执行，已保留现有回执。' }}</p>
                    <div v-for="action in job.actions.filter(item => item.approvalStatus === 'PENDING')" :key="action.actionId" class="task-action">
                        <strong>{{ automationActionLabel(action) }}</strong>
                        <blockquote v-if="action.payload.text">{{ action.payload.text }}</blockquote>
                        <p>这类对外发送需要你批准一次。</p>
                        <el-button size="small" type="primary" :disabled="!!busy" @click="approve(action, 'APPROVE')">批准本次操作</el-button>
                        <el-button size="small" :disabled="!!busy" @click="approve(action, 'DECLINE')">不执行</el-button>
                    </div>
                </details>
            </div>
        </details>
    </section>
</template>
<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {subscribeUnifiedAutomation, approveAutomationAction, cancelAutomationJob, stopGreetingContinuation} from '../../platform/unifiedRuntime'
import {PushRunStore} from '../../stores/pushRun'
import {automationActionLabel, automationJobLabel} from '../../platform/automationPresentation'
import type {AutomationAction, AutomationSnapshot} from '../../platform/unifiedAutomation'
import {ElMessage} from '../../utils/tools'

const state = ref<AutomationSnapshot>({status: null, jobs: [], error: '', held: 0, updatedAt: 0})
const busy = ref('')
const pushRun = PushRunStore()
let dispose: (() => void) | undefined

const outcomeCounts = computed(() => state.value.status?.outcomes.tasks?.counts || {})
const outcomeCompleted = computed(() => Number(outcomeCounts.value.COMPLETED || 0))
const outcomeProcessing = computed(() => ['READY', 'RETRY', 'RUNNING', 'CONFIRMATION_READY', 'WAITING_CONFIRMATION']
    .reduce((sum, key) => sum + Number(outcomeCounts.value[key] || 0), 0))
const outcomeFailed = computed(() => Number(outcomeCounts.value.FAILED || 0))
const actionProcessing = computed(() => state.value.status
    ? state.value.status.counts.queued + state.value.status.counts.running + state.value.status.counts.waitingExecution
    : 0)
const processingCount = computed(() => outcomeProcessing.value + actionProcessing.value)
const activeJobs = computed(() => state.value.jobs.filter(job =>
    ['READY', 'QUEUED', 'RUNNING', 'WAITING_EXECUTION', 'WAITING_CONFIRMATION', 'UNCERTAIN', 'FAILED'].includes(job.status)))
const actionRequired = computed(() => activeJobs.value.reduce((count, job) => count
    + job.actions.filter(action => action.approvalStatus === 'PENDING').length, 0))
const healthy = computed(() => !!state.value.status && !state.value.error
    && state.value.status.agent.state === 'READY' && state.value.status.executor.state === 'READY')
const healthLabel = computed(() => healthy.value ? '运行正常' : state.value.status ? '状态需检查' : '正在连接')
const kindLabel = (value: string) => ({REPLY: '自动回复', APPLICATION: '筛选与投递', CAREER_REVIEW: '求职复盘'} as Record<string, string>)[value] || '自动任务'

async function cancelJob(jobId: string) {
    if (busy.value) return
    busy.value = jobId
    try { await cancelAutomationJob(jobId); ElMessage.success('待发操作已取消') }
    catch { ElMessage.warning('取消结果尚未确认，请稍后查看状态') }
    finally { busy.value = '' }
}
async function approve(action: AutomationAction, decision: 'APPROVE' | 'DECLINE') {
    if (busy.value) return
    busy.value = action.actionId
    try { await approveAutomationAction(action, decision); ElMessage.success(decision === 'APPROVE' ? '已批准本次操作' : '本次操作已取消') }
    catch { ElMessage.warning('操作结果尚未确认，请稍后查看状态') }
    finally { busy.value = '' }
}
onMounted(() => { dispose = subscribeUnifiedAutomation(value => { state.value = value }) })
onUnmounted(() => dispose?.())
</script>
<style scoped>
.automation-tasks{margin:12px 0;border:1px solid #d6e3df;border-radius:8px;color:#243b33;background:#f8fbfa;font-size:13px;overflow:hidden}
.automation-overview{padding:0}.automation-summary{display:flex;align-items:center;gap:8px;min-height:22px;padding:10px 12px;cursor:pointer;list-style:none}
.automation-summary::-webkit-details-marker{display:none}.automation-summary::before{content:'▶';font-size:10px;color:#5d746b;transition:transform .15s ease}.automation-overview[open]>.automation-summary::before{transform:rotate(90deg)}
.summary-ok{color:#2f7d45}.summary-warning,.task-warning{color:#87551a}.summary-action{margin-left:auto;color:#409eff;font-weight:500}.collapse-label{display:none}.automation-overview[open]>.automation-summary .expand-label{display:none}.automation-overview[open]>.automation-summary .collapse-label{display:inline}
.automation-details{max-height:280px;overflow-y:auto;padding:2px 12px 12px;border-top:1px solid #d6e3df}.automation-tasks p{margin:8px 0;overflow-wrap:anywhere}.automation-details>details{padding:10px 0;border-top:1px solid #d6e3df}.automation-tasks summary{cursor:pointer;font-weight:600}
.task-action{padding:8px;border:1px solid #d6e3df;margin-top:8px;background:#fff}.task-action blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:8px;background:#f3f6f5}
@media (max-width:720px){.automation-summary{flex-wrap:wrap}.summary-action{margin-left:0}.automation-summary strong{flex:1}}
</style>
