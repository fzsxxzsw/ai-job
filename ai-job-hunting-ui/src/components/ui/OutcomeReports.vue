<template>
    <AutomationTasks/>
    <section class="outcome-panel" aria-label="投递结果自动分析">
        <div class="outcome-heading">
            <strong>投递结果自动分析</strong>
            <el-tag size="small" effect="plain">{{ outcomeSubscriptionLabel(automation.status, state.updatedAt, state.error || automation.error) }}</el-tag>
            <span v-if="state.pending">{{ state.pending }} 条观察待同步</span>
        </div>
        <p v-if="state.captureDiagnostic" class="outcome-warning" role="status">{{ state.captureDiagnostic }}</p>
        <p v-if="state.error" class="outcome-warning" role="status">{{ state.error }}</p>
        <p v-if="state.unbound || state.discarded" class="outcome-warning" role="status">
            {{ state.unbound }} 条消息等待可靠的岗位／会话关联；{{ state.discarded }} 条因本页队列上限或过期未能关联。
        </p>
        <p v-if="state.blocked || state.expired" class="outcome-warning">
            {{ state.blocked }} 条观察待核实；{{ state.expired }} 条过期观察已停止重试。
        </p>
        <p v-if="!state.items.length" class="outcome-empty">收到可关联的聊天或投递记录后自动分析，报告会出现在这里。</p>
        <details v-for="item in state.items" :key="item.caseId" class="outcome-case" :open="isCurrent(item)">
            <summary>
                <el-tag :type="reportColor(item)" size="small">{{ outcomeLivePresentation(item).label }}</el-tag>
                <span>{{ isCurrent(item) ? '当前会话' : '其他投递' }}</span>
                <span>{{ outcomeLivePresentation(item).status }}</span>
            </summary>
            <p class="outcome-meta">当前状态：{{ outcomeLivePresentation(item).status }} · 最近观察 {{ formatTime(item.lastObservedAt) }}</p>
            <p v-if="!item.report">{{ caseStatus(item.status) }}</p>
            <div v-if="item.task" class="outcome-task" aria-label="分析任务阶段">
                <strong>{{ outcomeTaskLabel(item.task) }}</strong>
                <ol><li v-for="(step, index) in item.task.phaseHistory" :key="`${step.phase}-${index}`">{{ outcomePhaseLabel(step.phase) }}</li></ol>
                <p v-if="item.task.lastErrorCode" class="outcome-warning">{{ taskError(item.task.lastErrorCode) }}<span v-if="item.task.nextAttemptAt"> 下次重试：{{ formatTime(item.task.nextAttemptAt) }}</span></p>
                <small>已尝试 {{ item.task.attempts }} 次</small>
            </div>
            <template v-if="item.report">
                <p :class="{'outcome-warning': !item.report.isCurrent || item.report.revision !== item.revision}">{{ outcomeReportNotice(item) }} · 第 {{ item.report.revision }} 版</p>
                <p>报告摘要：{{ item.report.summary }}</p>
                <p class="outcome-meta">报告生成时：{{ waitingLabel(item.report.waitingOn) }} · {{ readLabel(item.report.readState) }} · {{ item.report.analysisSource === 'RULES_AI' ? '模型辅助分析' : '规则分析' }} · 报告观察截至 {{ formatTime(item.report.asOf) }}</p>
                <template v-if="item.report.outcome === 'REJECTED'">
                    <h4>明确原因</h4>
                    <p v-if="!item.report.explicitReasons.length">未知</p>
                    <p v-for="(reason, index) in item.report.explicitReasons" :key="`explicit-${index}`">{{ reason.label || reason.code }}：{{ reason.reason }} <small v-if="reason.evidenceIds?.length">证据：{{ reason.evidenceIds.join('、') }}</small></p>
                    <h4>推断风险</h4>
                    <p v-if="!item.report.inferredRisks.length">暂无可验证推断</p>
                    <p v-for="(risk, index) in item.report.inferredRisks" :key="`risk-${index}`">{{ risk.label || risk.code }}：{{ risk.reason }} <small v-if="risk.evidenceIds?.length">证据：{{ risk.evidenceIds.join('、') }}</small></p>
                </template>
                <OutcomeEvidenceList :evidence="item.report.evidence"/>
                <h4 v-if="item.report.unknowns.length">尚缺信息</h4>
                <ul><li v-for="unknown in item.report.unknowns" :key="unknown">{{ unknown }}</li></ul>
                <h4 v-if="item.report.suggestions.length">建议</h4>
                <ul><li v-for="suggestion in item.report.suggestions" :key="suggestion">{{ suggestion }}</li></ul>
                <div class="outcome-feedback">
                    <el-tag size="small" effect="plain">{{ feedbackLabel(item.report.feedbackStatus) }}</el-tag>
                    <el-button size="small" type="success" :loading="busy === item.report.reportId" @click="feedback(item, 'CONFIRM')">确认</el-button>
                    <el-button size="small" :loading="busy === item.report.reportId" @click="feedback(item, 'CORRECT')">纠正</el-button>
                    <el-button size="small" :loading="busy === item.report.reportId" @click="feedback(item, 'IGNORE')">忽略</el-button>
                </div>
            </template>
        </details>
        <small class="outcome-meta">未取得精确阅读标记和完整最新会话时保留“信息不足”；不会自动修改简历、筛选条件或发送消息。</small>
    </section>
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue'
import {ElMessageBox} from 'element-plus'
import {ElMessage} from '../../utils/tools'
import {getSelectedConversationIdentity} from '../../platform/deliveryAudit'
import OutcomeEvidenceList from './OutcomeEvidenceList.vue'
import AutomationTasks from './AutomationTasks.vue'
import {subscribeUnifiedAutomation} from '../../platform/unifiedRuntime'
import {outcomeSubscriptionLabel} from '../../platform/automationPresentation'
import type {AutomationSnapshot} from '../../platform/unifiedAutomation'
import {sendOutcomeFeedback, subscribeOutcomeReports, watchCurrentOutcomeConversation} from '../../platform/boss/outcomeRuntime'
import {outcomeLivePresentation, outcomePhaseLabel, outcomeTaskLabel, outcomeReportNotice} from '../../extension/outcomesProtocol'
import type {OutcomeCase, OutcomeReport, OutcomeStatus} from '../../extension/outcomesProtocol'

const state = ref<OutcomeStatus & {unbound: number; discarded: number; captureDiagnostic?: string}>({scope: '', pending: 0, blocked: 0, expired: 0, error: '', items: [], updatedAt: 0, unbound: 0, discarded: 0})
const busy = ref('')
const automation = ref<AutomationSnapshot>({status: null, jobs: [], error: '', held: 0, updatedAt: 0})
let disposeAutomation: (() => void) | undefined
const requestIds = new Map<string, string>()
let disposeReports: (() => void) | undefined
let disposeConversation: (() => void) | undefined
const formatTime = (value: number) => value ? new Date(value).toLocaleString() : '未知'
const isCurrent = (item: OutcomeCase) => !!item.conversationKey && getSelectedConversationIdentity(document)?.conversationKey === item.conversationKey
const readLabel = (value: string) => ({READ: '对方已读', UNREAD: '对方未读', UNKNOWN: '阅读状态未知'} as Record<string, string>)[value] || '阅读状态未知'
const waitingLabel = (value: string) => ({HR: '等待 HR', USER: '等待你的回应', NONE: '当前无需回复', UNKNOWN: '下一步未知'} as Record<string, string>)[value] || '下一步未知'
const feedbackLabel = (value: string) => ({PENDING: '待确认', CONFIRMED: '已确认', CORRECTED: '已纠正', IGNORED: '已忽略'} as Record<string, string>)[value] || '待确认'
const reportColor = (value: Pick<OutcomeCase, 'outcome'>) => value.outcome === 'REJECTED' ? 'warning' : value.outcome === 'POSITIVE' ? 'success' : 'info'
const caseStatus = (status: string) => status === 'WAITING_OBSERVATION' ? '等待新的可靠观察' : status === 'FAILED' ? '分析未完成，请查看任务状态' : '观察已保存，等待任务处理'
const taskError = (error: string) => error === 'INVALID_ARTIFACT' ? '分析未通过证据校验，未发布报告。' : error === 'CHECKPOINT_UNAVAILABLE' ? '任务恢复存储暂不可用，等待重试。' : '分析依赖暂不可用，已保留任务。'

async function feedback(item: OutcomeCase, action: 'CONFIRM' | 'CORRECT' | 'IGNORE') {
    const report = item.report
    if (!report || busy.value) return
    const capturedScope = state.value.scope
    let correctedReason: string | null = null
    if (action === 'CORRECT') {
        try {
            const response = await ElMessageBox.prompt('请说明更准确的结果或原因。反馈会保留原始证据。', '纠正分析',
                {inputPattern: /\S+/, inputErrorMessage: '请输入纠正内容', confirmButtonText: '保存纠正', cancelButtonText: '取消'})
            correctedReason = response.value.trim().slice(0, 1000)
        } catch { return }
    }
    if (capturedScope !== state.value.scope) return
    const key = JSON.stringify([capturedScope, report.reportId, action, correctedReason])
    const requestId = requestIds.get(key) || crypto.randomUUID()
    requestIds.set(key, requestId)
    busy.value = report.reportId
    try {
        const result = await sendOutcomeFeedback(report.reportId, {requestId, action, correctedReason, correctedOutcome: null})
        if (capturedScope !== state.value.scope) return
        const current = state.value.items.find(value => value.caseId === item.caseId)
        if (current?.report?.reportId === result.reportId) current.report = result
        ElMessage.success('本版本报告的反馈已保存')
    } catch { ElMessage.warning('反馈暂未确认，可再次点击重试') }
    finally { busy.value = '' }
}
onMounted(() => {
    disposeAutomation = subscribeUnifiedAutomation(value => { automation.value = value })
    disposeReports = subscribeOutcomeReports(value => { state.value = value })
    disposeConversation = watchCurrentOutcomeConversation()
})
onUnmounted(() => { disposeReports?.(); disposeConversation?.(); disposeAutomation?.() })
</script>

<style scoped>
.outcome-panel{margin:12px 0;padding:12px;border:1px solid #dce6e2;border-radius:8px;background:#f8fbfa;font-size:13px;color:#243b33}
.outcome-heading,.outcome-feedback{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.outcome-case{padding:10px 0;border-top:1px solid #dce6e2;margin-top:10px}
.outcome-case summary{display:flex;gap:8px;align-items:center;cursor:pointer;flex-wrap:wrap}
.outcome-case h4{margin:10px 0 4px}.outcome-case p{margin:6px 0;overflow-wrap:anywhere}
.outcome-case blockquote{margin:6px 0;padding:6px 10px;border-left:3px solid #92b9ab;background:white;white-space:pre-wrap;overflow-wrap:anywhere}
.outcome-task{padding:8px;background:#eef4f1;margin:8px 0}.outcome-task ol{display:flex;gap:16px;flex-wrap:wrap;margin:6px 0;padding-left:18px}
.outcome-warning{color:#925000}.outcome-meta,.outcome-empty{color:#687d73;font-size:12px}.outcome-panel>small{display:block;margin-top:10px}
</style>
