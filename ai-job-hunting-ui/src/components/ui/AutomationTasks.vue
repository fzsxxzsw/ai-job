<template>
    <section class="automation-tasks" aria-label="自动求职助手">
        <details class="automation-overview" @toggle="onOverviewToggle">
            <summary class="automation-summary">
                <strong>自动求职助手</strong>
                <el-tag size="small">{{ state.status?.enabled ? '已启用' : state.status ? '兼容模式' : '正在连接' }}</el-tag>
                <span :class="healthy ? 'summary-ok' : 'summary-warning'">{{ healthLabel }}</span>
                <span v-if="runningCount">运行中 {{ runningCount }}</span>
                <span v-if="waitingBrowserCount" class="summary-warning">待浏览器 {{ waitingBrowserCount }}</span>
                <span v-if="waitingApprovalCount" class="summary-warning">待确认 {{ waitingApprovalCount }}</span>
                <span v-if="uncertainCount" class="summary-warning">待核实 {{ uncertainCount }}</span>
                <span class="summary-action"><span class="expand-label">查看详情</span><span class="collapse-label">收起</span></span>
            </summary>
            <div class="automation-details">
                <p v-if="state.error" class="task-warning" role="status">{{ state.error }}</p>
                <template v-if="state.status">
                    <p>{{ healthy ? '分析服务和浏览器执行器在线；单项任务是否可执行以其状态为准。' : '部分服务状态异常，请查看服务器连接。' }}</p>
                    <p>自动分析：运行中 {{ outcomeRunning }} · 排队 {{ outcomeQueued }} · 等待结果确认 {{ outcomeWaiting }} · 已完成 {{ outcomeCompleted }}<span v-if="outcomeFailed"> · 失败 {{ outcomeFailed }}</span></p>
                    <p>回复与投递：运行中 {{ actionRunning }} · 排队 {{ actionQueued }} · 待浏览器执行 {{ waitingBrowserCount }} · 待确认 {{ waitingApprovalCount }} · 待核实 {{ uncertainCount }} · 失败 {{ actionFailed }}<span v-if="reviewedUncertainCount"> · 已归档未知结果 {{ reviewedUncertainCount }}</span></p>
                    <small>分析报告会自动完成并显示在对应会话与求职复盘中，无需逐条确认。</small>
                </template>
                <div class="task-browser">
                    <el-button size="small" :type="listMode === 'active' ? 'primary' : 'default'" @click="selectMode('active')">未结任务</el-button>
                    <el-button size="small" :type="listMode === 'all' ? 'primary' : 'default'" @click="selectMode('all')">全部历史</el-button>
                    <el-button size="small" :disabled="loading" @click="loadPage(page)">刷新列表</el-button>
                    <span v-if="loaded">第 {{ page }} 页</span>
                    <el-button v-if="loaded" size="small" :disabled="loading || page === 1" @click="loadPage(page - 1)">上一页</el-button>
                    <el-button v-if="loaded" size="small" :disabled="loading || !hasNext" @click="loadPage(page + 1)">下一页</el-button>
                </div>
                <p v-if="loading" role="status">正在读取任务…</p>
                <p v-if="listError" class="task-warning" role="status">{{ listError }}</p>
                <p v-if="loaded && !loading && !visibleJobs.length">{{ listMode === 'active' ? '目前没有未结任务。' : '暂无历史任务。' }}</p>
                <el-button v-if="pushRun.status === 'completed'" size="small" :disabled="!!busy" @click="stopGreetingContinuation">停止本轮待发招呼</el-button>
                <details v-for="job in visibleJobs" :key="job.jobId" :open="job.status === 'WAITING_CONFIRMATION'">
                    <summary>{{ kindLabel(job.kind) }} · {{ recordLabel(job) }} · {{ automationJobLabel(job) }} · {{ formatTime(job.createdAt) }}</summary>
                    <el-button v-if="!['COMPLETED', 'CANCELLED', 'SUPERSEDED', 'FAILED'].includes(job.status) && job.actions.some(action => action.status === 'QUEUED' || action.status === 'LEASED')" size="small" :disabled="!!busy" @click="cancelJob(job.jobId)">取消本任务待发动作</el-button>
                    <p v-if="job.decision">{{ job.decision.reason }}</p>
                    <p v-if="job.status === 'UNCERTAIN'" class="task-warning">{{ hasUnknownSend(job) ? '消息是否送达仍未证实。请按记录时间在对应聊天中核对；系统不会自动重复发送。' : '任务结果尚未确认。请查看任务原因与原始回执；系统不会自动重复执行未确认动作。' }}</p>
                    <p v-else-if="job.lastErrorCode && job.status === 'FAILED'" class="task-warning">任务未完整执行，已保留现有回执。</p>
                    <template v-if="job.status === 'UNCERTAIN'">
                        <p v-if="job.reviewedAt">已于 {{ formatTime(job.reviewedAt) }} 归档提醒；原始状态和回执仍保留在历史记录中。</p>
                        <el-button size="small" :disabled="!!busy" @click="reviewJob(job.jobId, !job.reviewedAt)">{{ job.reviewedAt ? '重新列入待核实' : '归档此提醒（结果仍未知）' }}</el-button>
                    </template>
                    <div v-for="action in job.actions" :key="action.actionId" class="task-action">
                        <strong>{{ automationActionLabel(action) }}</strong>
                        <template v-if="automationApprovalAvailable(job, action)">
                            <blockquote v-if="action.payload.text">{{ action.payload.text }}</blockquote>
                            <p>这类对外发送需要你批准一次。</p>
                            <el-button size="small" type="primary" :disabled="!!busy" @click="approve(action, 'APPROVE')">批准本次操作</el-button>
                            <el-button size="small" :disabled="!!busy" @click="approve(action, 'DECLINE')">不执行</el-button>
                        </template>
                    </div>
                </details>
            </div>
        </details>
    </section>
</template>
<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {subscribeUnifiedAutomation, approveAutomationAction, cancelAutomationJob, listAutomationJobs, reviewAutomationJob, stopGreetingContinuation} from '../../platform/unifiedRuntime'
import {PushRunStore} from '../../stores/pushRun'
import {automationActionLabel, automationApprovalAvailable, automationJobLabel} from '../../platform/automationPresentation'
import type {AutomationAction, AutomationJob, AutomationSnapshot} from '../../platform/unifiedAutomation'
import {ElMessage} from '../../utils/tools'

const state = ref<AutomationSnapshot>({status: null, jobs: [], error: '', held: 0, updatedAt: 0})
const busy = ref('')
const pushRun = PushRunStore()
let dispose: (() => void) | undefined
const PAGE_SIZE = 20
const page = ref(1)
const visibleJobs = ref<AutomationJob[]>([])
const hasNext = ref(false)
const loaded = ref(false)
const loading = ref(false)
const listError = ref('')
const listMode = ref<'active' | 'all'>('active')
let listRequest = 0

const outcomeCounts = computed(() => state.value.status?.outcomes.tasks?.counts || {})
const outcomeCompleted = computed(() => Number(outcomeCounts.value.COMPLETED || 0))
const outcomeQueued = computed(() => ['READY', 'RETRY']
    .reduce((sum, key) => sum + Number(outcomeCounts.value[key] || 0), 0))
const outcomeWaiting = computed(() => ['CONFIRMATION_READY', 'WAITING_CONFIRMATION']
    .reduce((sum, key) => sum + Number(outcomeCounts.value[key] || 0), 0))
const outcomeRunning = computed(() => Number(outcomeCounts.value.RUNNING || 0))
const outcomeFailed = computed(() => Number(outcomeCounts.value.FAILED || 0))
const actionQueued = computed(() => state.value.status?.counts.queued || 0)
const actionRunning = computed(() => state.value.status?.counts.running || 0)
const waitingBrowserCount = computed(() => state.value.status?.counts.waitingExecution || 0)
const waitingApprovalCount = computed(() => state.value.status?.counts.waitingConfirmation || 0)
const uncertainCount = computed(() => state.value.status?.counts.uncertain || 0)
const reviewedUncertainCount = computed(() => state.value.status?.counts.reviewedUncertain || 0)
const actionFailed = computed(() => state.value.status?.counts.failed || 0)
const runningCount = computed(() => outcomeRunning.value + actionRunning.value)
const healthy = computed(() => !!state.value.status && !state.value.error
    && state.value.status.agent.state === 'READY' && state.value.status.executor.state === 'READY')
const healthLabel = computed(() => healthy.value ? '服务在线' : state.value.status ? '服务需检查' : '正在连接')
const kindLabel = (value: string) => ({REPLY: '自动回复', APPLICATION: '筛选与投递', CAREER_REVIEW: '求职复盘'} as Record<string, string>)[value] || '自动任务'
const formatTime = (value: number) => value ? new Date(value).toLocaleString('zh-CN') : '时间未知'
const recordLabel = (job: AutomationJob) => {
    const display = job.display
    const identity = [display?.companyName, display?.jobTitle, display?.recruiterName].filter(Boolean).join(' · ')
    return identity ? `${identity}（记录 ${job.jobId.slice(0, 8)}）` : `记录 ${job.jobId.slice(0, 8)}`
}
const hasUnknownSend = (job: AutomationJob) => job.actions.some(action =>
    action.status === 'UNKNOWN' && ['SEND_TEXT', 'SEND_GREETING'].includes(action.kind))

async function loadPage(target = page.value) {
    const request = ++listRequest
    loading.value = true
    listError.value = ''
    try {
        const items = await listAutomationJobs((target - 1) * PAGE_SIZE, PAGE_SIZE + 1, listMode.value === 'active')
        if (request !== listRequest) return
        if (!items.length && target > 1 && listMode.value === 'active') { void loadPage(target - 1); return }
        visibleJobs.value = items.slice(0, PAGE_SIZE)
        hasNext.value = items.length > PAGE_SIZE
        page.value = target
        loaded.value = true
    } catch {
        if (request === listRequest) listError.value = '任务列表暂不可用，请稍后刷新。'
    } finally {
        if (request === listRequest) loading.value = false
    }
}
function selectMode(mode: 'active' | 'all') {
    if (listMode.value === mode && loaded.value) return
    listMode.value = mode
    loaded.value = false
    visibleJobs.value = []
    void loadPage(1)
}
function onOverviewToggle(event: Event) {
    if ((event.target as HTMLDetailsElement).open && !loaded.value) void loadPage(1)
}

async function cancelJob(jobId: string) {
    if (busy.value) return
    busy.value = jobId
    try { await cancelAutomationJob(jobId); ElMessage.success('待发操作已取消'); await loadPage(page.value) }
    catch { ElMessage.warning('取消结果尚未确认，请稍后查看状态') }
    finally { busy.value = '' }
}
async function reviewJob(jobId: string, reviewed: boolean) {
    if (busy.value) return
    busy.value = jobId
    try {
        await reviewAutomationJob(jobId, reviewed)
        ElMessage.success(reviewed ? '提醒已归档，原始结果仍未核实' : '已重新列入待核实')
        await loadPage(page.value)
    } catch { ElMessage.warning('操作结果尚未确认，请刷新任务列表核对') }
    finally { busy.value = '' }
}
async function approve(action: AutomationAction, decision: 'APPROVE' | 'DECLINE') {
    if (busy.value) return
    busy.value = action.actionId
    try { await approveAutomationAction(action, decision); ElMessage.success(decision === 'APPROVE' ? '已批准本次操作' : '本次操作已取消'); await loadPage(page.value) }
    catch { ElMessage.warning('操作结果尚未确认，请稍后查看状态') }
    finally { busy.value = '' }
}
onMounted(() => { dispose = subscribeUnifiedAutomation(value => { state.value = value }) })
onUnmounted(() => dispose?.())
watch(() => JSON.stringify(state.value.status?.counts || {}), (current, previous) => {
    if (loaded.value && listMode.value === 'active' && current !== previous) void loadPage(page.value)
})
</script>
<style scoped>
.automation-tasks{margin:12px 0;border:1px solid #d6e3df;border-radius:8px;color:#243b33;background:#f8fbfa;font-size:13px;overflow:hidden}
.automation-overview{padding:0}.automation-summary{display:flex;align-items:center;gap:8px;min-height:22px;padding:10px 12px;cursor:pointer;list-style:none}
.automation-summary::-webkit-details-marker{display:none}.automation-summary::before{content:'▶';font-size:10px;color:#5d746b;transition:transform .15s ease}.automation-overview[open]>.automation-summary::before{transform:rotate(90deg)}
.summary-ok{color:#2f7d45}.summary-warning,.task-warning{color:#87551a}.summary-action{margin-left:auto;color:#409eff;font-weight:500}.collapse-label{display:none}.automation-overview[open]>.automation-summary .expand-label{display:none}.automation-overview[open]>.automation-summary .collapse-label{display:inline}
.automation-details{max-height:280px;overflow-y:auto;padding:2px 12px 12px;border-top:1px solid #d6e3df}.automation-tasks p{margin:8px 0;overflow-wrap:anywhere}.automation-details>details{padding:10px 0;border-top:1px solid #d6e3df}.automation-tasks summary{cursor:pointer;font-weight:600}
.task-browser{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0}.task-browser .el-button+.el-button{margin-left:0}
.task-action{padding:8px;border:1px solid #d6e3df;margin-top:8px;background:#fff}.task-action blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:8px;background:#f3f6f5}
@media (max-width:720px){.automation-summary{flex-wrap:wrap}.summary-action{margin-left:0}.automation-summary strong{flex:1}}
</style>
