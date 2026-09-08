<template>
    <section class="career-workspace" aria-label="求职复盘与简历策略">
        <h3>求职进展</h3>
        <p class="career-note">这里帮你看哪些投递收到了回复、面试或 Offer，并根据已确认的记录准备下一轮建议。数据不足时只保存记录，不会草率调整策略。</p>
        <p v-if="error" class="career-warning" role="status">{{ error }}</p>
        <el-button size="small" :loading="busy === 'load'" :disabled="!!busy" @click="load">刷新记录</el-button>
        <el-tabs v-model="tab">
            <el-tab-pane label="结果概览" name="records">
                <div class="career-controls">
                    <label>观察窗口 <el-select v-model="windowDays" style="width:110px"><el-option v-for="days in [7,14,30]" :key="days" :label="`${days} 天`" :value="days"/></el-select></label>
                    <label>简历版本 <el-select v-model="metricVersionId" clearable placeholder="全部版本" style="width:190px"><el-option v-for="version in versions" :key="version.versionId" :value="version.versionId" :label="versionName(version)"/></el-select></label>
                    <el-button size="small" :disabled="!!busy" @click="refreshAnalytics">更新统计</el-button>
                    <el-button size="small" :disabled="!!busy" @click="importHistory">导入已有历史快照</el-button>
                </div>
                <template v-if="analytics">
                    <div class="career-summary">
                        <article><strong>{{ analytics.progressCounts.contacted }}</strong><span>已发起沟通</span></article>
                        <article><strong>{{ analytics.progressCounts.replied }}</strong><span>收到 HR 回复</span></article>
                        <article><strong>{{ analytics.progressCounts.interviewed }}</strong><span>获得面试机会</span></article>
                        <article><strong>{{ analytics.progressCounts.offers }}</strong><span>收到 Offer</span></article>
                    </div>
                    <p v-if="analytics.sampleSize < 20" class="career-guidance">已有 {{ analytics.sampleSize }} 条记录完成观察周期。继续积累到 20 条后，再判断简历或投递策略是否需要调整。</p>
                    <p v-else class="career-guidance">已有足够记录用于初步复盘。比例只反映已保存的结果，最终建议仍需结合岗位方向和真实反馈确认。</p>
                </template>
                <details class="career-basis">
                    <summary>查看统计依据和历史记录</summary>
                    <template v-if="analytics">
                        <p>统计截至 {{ formatTime(analytics.cutoff) }}。以下内容用于核对数据来源，不需要日常查看。</p>
                        <table class="career-table"><thead><tr><th>结果</th><th>截至当前</th><th>当前比例</th><th>用于智能优化</th><th>依据</th></tr></thead>
                            <tbody><tr v-for="row in metricRows" :key="row.key"><td>{{ row.label }}</td><td>{{ row.numerator }} / {{ row.denominator }}</td><td>{{ row.rateLabel }}</td><td>{{ row.readiness }}</td><td><el-button size="small" :disabled="!!busy" @click="drilldown(row)">查看记录</el-button></td></tr></tbody>
                        </table>
                        <p>当前比例用于跟踪真实进展；满 {{ analytics.windowDays }} 天且证据完整的记录才进入稳定复盘，供智能体调整投递方向、简历版本和回复建议。</p>
                        <p>尚未到观察时间 {{ analytics.excludedCounts.immature }} · 沟通记录未确认 {{ analytics.excludedCounts.unverifiedContact }} · 发送的简历版本未知 {{ analytics.excludedCounts.unknownExposure }} · 同一投递出现多个版本 {{ analytics.excludedCounts.mixedExposure }}</p>
                        <ul><li v-for="item in analytics.uncertainties" :key="item">{{ item }}</li></ul>
                    </template>
                    <p v-if="!applications.length">当前页没有投递记录。导入历史记录后，系统会保留当时资料；无法确认的附件版本会明确标为未知。</p>
                    <details v-for="application in applications" :key="application.applicationId">
                        <summary>{{ application.jobTitle || application.encryptJobId }} · 当前进展：{{ eventLabel(application.currentStage) }} · 最终结果：{{ eventLabel(application.outcome) }}</summary>
                        <p>发起沟通 {{ formatTime(application.contactedAt) }} · 实际发送的简历：{{ exposureLabel(application.resumeExposure) }}</p>
                        <p>准备版本 {{ application.preparedResumeVersionId || '未选择' }} · 下一轮策略 {{ application.strategyPlanId || '未选择' }}</p>
                        <ol><li v-for="event in application.events" :key="event.eventId">{{ formatTime(event.occurredAt) }} · {{ eventLabel(event.eventType) }} · {{ confirmationLabel(event.confirmation) }}<blockquote v-if="event.evidence.quote">{{ event.evidence.quote }}</blockquote><small v-if="event.supersedesEventId">纠正原事件 {{ event.supersedesEventId }}，原记录保留。</small><el-button size="small" :disabled="!!busy" @click="openEvent(application, event.eventId)">追加纠正</el-button></li></ol>
                        <el-button size="small" :disabled="!!busy" @click="openEvent(application)">确认结果或实际附件版本</el-button>
                    </details>
                    <div class="career-controls"><el-button size="small" :disabled="!!busy || applicationOffset === 0" @click="pageApplications(-20)">上一页</el-button><span>第 {{ applicationOffset / 20 + 1 }} 页</span><el-button size="small" :disabled="!!busy || applications.length < 20" @click="pageApplications(20)">下一页</el-button></div>
                </details>
            </el-tab-pane>
            <el-tab-pane label="简历与改稿" name="resumes">
                <p>下一轮准备版本：{{ selection.preparedResumeVersionId || '未选择' }}。平台附件仍由原附件配置控制；此处不会上传附件。</p>
                <label>新增简历文本<el-input v-model="resumeText" type="textarea" :rows="7" maxlength="60000" placeholder="粘贴你要保存的真实简历内容"/></label>
                <label>可核验事实（每行一项，可选）<el-input v-model="resumeFacts" type="textarea" :rows="3" maxlength="10000" placeholder="填写简历中已有、可核验的经历或能力；不会补造数字、公司或技能"/></label>
                <el-button size="small" :disabled="!!busy || !resumeText.trim()" @click="createVersion">保存为新准备版本</el-button>
                <details v-for="version in versions" :key="version.versionId">
                    <summary>{{ versionName(version) }} {{ selection.preparedResumeVersionId === version.versionId ? '· 下一轮已选择' : '' }}</summary>
                    <pre>{{ version.content }}</pre>
                    <div class="career-controls"><el-button size="small" :disabled="!!busy || selection.preparedResumeVersionId === version.versionId" @click="selectVersion(version)">选择用于下一轮</el-button><el-button size="small" @click="copyVersion(version)">复制文本</el-button><el-button size="small" @click="downloadVersion(version)">下载 Markdown</el-button></div>
                </details>
                <div class="career-controls"><el-button size="small" :disabled="!!busy || versionOffset === 0" @click="pageVersions(-20)">上一页</el-button><span>第 {{ versionOffset / 20 + 1 }} 页</span><el-button size="small" :disabled="!!busy || versions.length < 20" @click="pageVersions(20)">下一页</el-button></div>
                <template v-if="review?.review">
                    <h4>本次复盘的改稿建议</h4>
                    <p v-if="!review.review.resumeProposals.length">目前没有可验证的改稿建议。</p>
                    <article v-for="proposal in review.review.resumeProposals" :key="proposal.proposalId" class="career-proposal">
                        <p>基础版本 {{ proposal.baseVersionId }} · {{ proposal.status === 'ACCEPTED' ? '已创建版本 ' + proposal.acceptedVersionId : '待逐项选择' }}</p>
                        <div v-for="patch in proposal.patches" :key="patch.patchId" class="career-patch">
                            <el-checkbox :model-value="(selectedPatches[proposal.proposalId] || []).includes(patch.patchId)" :disabled="patch.verificationStatus !== 'SOURCE_SUPPORTED' || proposal.status === 'ACCEPTED' || !!busy" @change="togglePatch(proposal, patch.patchId, !!$event)">采用这一处格式整理</el-checkbox>
                            <div class="career-comparison"><div><small>原文</small><pre>{{ patch.originalText }}</pre></div><div><small>建议</small><pre>{{ patch.proposedText }}</pre></div></div>
                            <p>依据事实 {{ patch.factIds.join('、') || '不足' }} · 反馈 {{ patch.feedbackEventIds.join('、') || '无' }} · 岗位证据 {{ patch.jdRefs.join('、') || '无' }}</p>
                            <ul><li v-for="question in patch.unansweredQuestions" :key="question">待补充：{{ question }}</li></ul>
                            <p v-if="patch.verificationStatus === 'NEEDS_USER_INPUT'" class="career-warning">依据不足，补充真实信息后再改稿。</p>
                        </div>
                        <el-button size="small" :disabled="!!busy || !(selectedPatches[proposal.proposalId] || []).length || proposal.status === 'ACCEPTED'" @click="previewProposal(proposal)">预览选中修改</el-button>
                        <template v-if="previews[proposal.proposalId]">
                            <h5>即将保存的完整文本</h5><pre>{{ previews[proposal.proposalId].content }}</pre>
                            <el-button size="small" type="primary" :disabled="!!busy || !previewMatchesSelection(previews[proposal.proposalId], proposal, selectedPatches[proposal.proposalId] || [])" @click="acceptProposal(proposal)">确认此预览，创建新版本</el-button>
                        </template>
                    </article>
                </template>
            </el-tab-pane>
            <el-tab-pane label="下一轮计划" name="strategy">
                <div class="career-controls"><label>本轮目标 <el-input v-model="objective" maxlength="500" placeholder="例如：优先获得 Java 后端面试"/></label><label>下一轮投递预算 <el-input-number v-model="budget" :min="1" :max="1000" :precision="0"/></label></div>
                <p class="career-note">复盘使用所选 {{ windowDays }} 天窗口和下一轮准备版本，冻结服务器当前的薪资、地点、排除项等真实硬筛选。这里不会放宽它们。</p>
                <el-button type="primary" size="small" :disabled="!!busy || !objective.trim() || !budget" @click="createReview">创建复盘任务</el-button>
                <div class="career-controls"><el-button v-for="job in reviewJobs" :key="job.jobId" size="small" :disabled="!!busy" @click="openReview(job.jobId)">{{ formatTime(job.createdAt) }} · {{ automationJobLabel(job) }}</el-button></div>
                <p v-if="deletion">{{ deletion.checkpointDeleted ? '私密复盘及流程检查点已删除；历史投递事实与被引用版本保留。' : '正在删除私密复盘和流程检查点，尚未完成。' }}</p>
                <template v-if="review">
                    <h4>{{ automationJobLabel(review.job) }}</h4>
                    <ol class="career-controls"><li v-for="(phase, index) in review.job.phaseHistory" :key="index">{{ automationPhaseLabel(phase.phase) }}</li></ol>
                    <template v-if="review.review">
                        <p>{{ review.review.analysisSource === 'MODEL_ASSISTED' ? '模型辅助复盘' : '规则复盘' }} · 样本 {{ review.review.metricBundle.sampleSize }} · 截至 {{ formatTime(review.review.metricBundle.cutoff) }}</p>
                        <template v-if="review.review.modelAssistance">
                            <p :class="{'career-warning': review.review.modelAssistance.status === 'FALLBACK'}">{{ modelAssistanceLabel(review.review.modelAssistance) }}</p>
                            <p class="career-note">{{ review.review.modelAssistance.status === 'VALIDATED' ? '本次模型材料范围' : '本次准备材料范围（未确认模型分析成功）' }}：{{ review.review.modelAssistance.coverage.eventIds.length }} / {{ review.review.modelAssistance.coverage.frozenEventCount }} 条已冻结事件，{{ review.review.modelAssistance.coverage.jdRefs.length }} / {{ review.review.modelAssistance.coverage.frozenJobCount }} 份岗位资料；完整简历{{ review.review.modelAssistance.coverage.resumeIncluded ? '已选入' : '未选入' }}。未选入资料不作为模型依据，完整记录统计保持不变。</p>
                        </template>
                        <ul><li v-for="gap in review.review.gaps" :key="gap.kind + gap.summary">{{ gap.summary }}<span v-if="gap.question"> 待补充：{{ gap.question }}</span><small v-if="gap.basis === 'STATIC_MATCH'">（静态岗位与简历匹配，未证明实际拒绝原因）</small></li></ul>
                        <details><summary>复盘证据</summary><blockquote v-for="evidence in review.review.evidence" :key="evidence.eventId">{{ evidence.quote }} · {{ confirmationLabel(evidence.confirmation) }}</blockquote></details>
                        <ul><li v-for="unknown in review.review.uncertainties" :key="unknown">{{ unknown }}</li></ul>
                        <details v-if="review.review.strategyRationale?.length"><summary>策略建议的依据</summary>
                            <article v-for="(reason, index) in review.review.strategyRationale" :key="index">
                                <p>{{ reason.summary }}</p><p v-if="reason.question">待核实：{{ reason.question }}</p>
                                <p class="career-note">{{ reason.basis === 'DATA_EVIDENCE' ? '依据已确认求职记录' : '静态岗位与简历匹配，未证明求职结果原因' }} · 事件 {{ reason.evidenceIds.join('、') || '无' }} · 岗位 {{ reason.jdRefs?.join('、') || '无' }} · 简历事实 {{ reason.factIds?.join('、') || '无' }}</p>
                            </article>
                        </details>
                        <p class="career-note">模型建议不会增加未经核实的经历、技能或数字；当前可确认改稿仅做已有文本的格式整理。</p>
                        <p>改稿请在“简历版本与改稿”中逐项预览；策略仍需单独批准和应用。</p>
                        <div v-if="!review.confirmation" class="career-controls"><el-button size="small" :disabled="!!busy" @click="confirmReview('CONFIRM')">确认本次复盘</el-button><el-button size="small" :disabled="!!busy" @click="confirmReview('IGNORE')">忽略本次复盘</el-button></div>
                        <p v-else>你的复盘反馈：{{ review.confirmation.decision === 'CONFIRM' ? '已确认' : '已忽略' }}；流程状态以上方任务为准。</p>
                    </template>
                    <el-button type="danger" plain size="small" :disabled="!!busy" @click="deleteReview">删除本次私密复盘</el-button>
                </template>
                <h4>下一轮策略</h4><p>当前选择 {{ selection.strategyPlanId || '无' }}</p>
                <article v-for="strategy in allStrategies" :key="strategy.strategyId" class="career-proposal">
                    <strong>{{ strategy.objective || '目标待补充' }}</strong><p>预算 {{ strategy.budget ?? '待补充' }} · 测量窗口 {{ strategy.measurementWindowDays }} 天 · {{ strategy.status }}</p>
                    <table class="career-table"><thead><tr><th>分组</th><th>类型</th><th>数量</th><th>准备版本</th></tr></thead><tbody><tr v-for="allocation in strategy.allocations" :key="allocation.group"><td>{{ allocation.group }}</td><td>{{ categoryLabel(allocation.category) }}</td><td>{{ allocation.count }}</td><td>{{ allocation.resumeVersionId || '未选择' }}</td></tr></tbody></table>
                    <ul><li v-for="missing in strategy.missingInputs" :key="missing">待补充：{{ missing }}</li><li v-for="unknown in strategy.uncertainties" :key="unknown">{{ unknown }}</li></ul>
                    <div class="career-controls"><el-button size="small" :disabled="!!busy || strategy.status !== 'DRAFT' || !!strategy.missingInputs.length" @click="approveStrategy(strategy)">批准这份策略</el-button><el-button type="primary" size="small" :disabled="!!busy || strategy.status === 'DRAFT' || selection.strategyPlanId === strategy.strategyId" @click="applyStrategy(strategy)">应用到下一轮</el-button></div>
                </article>
            </el-tab-pane>
        </el-tabs>
        <el-dialog v-model="showSamples" title="指标样本" width="min(90vw, 850px)">
            <p>{{ sampleLabel }}</p><ul><li v-for="sample in sampleApplications" :key="sample.applicationId">{{ sampleMembership[sample.applicationId] }} · {{ sample.jobTitle || sample.encryptJobId }} · {{ sample.applicationId }} · 已到达 {{ eventLabel(sample.currentStage) }} · 结果 {{ eventLabel(sample.outcome) }}</li></ul>
        </el-dialog>
        <el-dialog v-model="showEvent" title="补充已发生的求职事实" width="min(90vw, 700px)" :close-on-click-modal="false">
            <p>{{ eventApplication?.jobTitle || eventApplication?.encryptJobId }} · {{ eventSupersedes ? '追加纠正，保留原事件。' : '只记录已发生的事实，不会发送消息或附件。' }}</p>
            <label>结果类型<el-select v-model="eventType"><el-option v-for="type in CAREER_EVENT_TYPES" :key="type" :value="type" :label="eventLabel(type)"/></el-select></label>
            <label>实际发生时间<el-date-picker v-model="eventTime" type="datetime" placeholder="选择实际时间" :disabled-date="(date: Date) => date.getTime() > Date.now()"/></label>
            <label>依据或原话<el-input v-model="eventQuote" type="textarea" :rows="3" maxlength="4000" placeholder="填写你实际核对的记录；不确定的内容请选推断备注"/></label>
            <el-radio-group v-model="eventConfirmation"><el-radio value="USER_CONFIRMED">我已核对并确认</el-radio><el-radio value="INFERRED">推断备注，未确认</el-radio></el-radio-group>
            <template v-if="eventType === 'RESUME_SENT'">
                <p>只有核对过当时发送附件内容，才选择对应版本。未知时留空；这是你的确认，不是平台文件校验。</p>
                <el-select v-model="eventVersionId" clearable placeholder="实际发送版本未知"><el-option v-for="version in versions" :key="version.versionId" :value="version.versionId" :label="versionName(version)"/></el-select>
            </template>
            <p v-if="error" class="career-warning">{{ error }}</p>
            <template #footer><el-button :disabled="!!busy" @click="showEvent = false">取消</el-button><el-button type="primary" :disabled="!!busy || !eventTime || !eventQuote.trim()" @click="saveEvent">保存这条事实</el-button></template>
        </el-dialog>
    </section>
</template>
<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {ElMessageBox} from 'element-plus'
import {ElMessage} from '../../utils/tools'
import {scopedCareerClient} from '../../platform/careerApi'
import {captureAutomationScope} from '../../platform/unifiedRuntime'
import {automationJobLabel, automationPhaseLabel} from '../../platform/automationPresentation'
import {CAREER_EVENT_TYPES, modelAssistanceLabel, metricRateLabel, progressRateLabel, previewMatchesSelection, type CareerEventInput, type ResumeVersion, type CareerApplication, type CareerAnalytics,
    type CareerProposal, type CareerPreview, type CareerReview, type CareerDeletion, type CareerSelection, type CareerStrategy} from '../../platform/careerProtocol'
import type {AutomationJob} from '../../platform/unifiedAutomation'
const tab = ref('records'), busy = ref(''), error = ref(''), windowDays = ref<7 | 14 | 30>(14), metricVersionId = ref('')
const versions = ref<ResumeVersion[]>([]), applications = ref<CareerApplication[]>([]), analytics = ref<CareerAnalytics | null>(null)
const reviewJobs = ref<AutomationJob[]>([]), review = ref<CareerReview | null>(null), deletion = ref<CareerDeletion | null>(null), strategies = ref<CareerStrategy[]>([])
const selection = ref<CareerSelection>({preparedResumeVersionId: null, strategyPlanId: null})
const selectedPatches = ref<Record<string, string[]>>({}), previews = ref<Record<string, CareerPreview>>({})
const resumeText = ref(''), resumeFacts = ref(''), objective = ref(''), budget = ref<number | undefined>()
const applicationOffset = ref(0), versionOffset = ref(0), showSamples = ref(false), sampleLabel = ref(''), sampleApplications = ref<CareerApplication[]>([])
const sampleMembership = ref<Record<string, string>>({})
const showEvent = ref(false), eventApplication = ref<CareerApplication | null>(null), eventSupersedes = ref<string | null>(null)
const eventType = ref<CareerEventInput['eventType']>('HR_REPLIED'), eventTime = ref<Date | null>(null), eventQuote = ref(''), eventVersionId = ref('')
const eventConfirmation = ref<CareerEventInput['confirmation']>('USER_CONFIRMED')
let eventRequest: CareerEventInput | null = null
let session: Awaited<ReturnType<typeof scopedCareerClient>> | null = null, timer: ReturnType<typeof setInterval> | undefined, disposed = false
let currentReviewId = '', reviewRequest: Parameters<Awaited<ReturnType<typeof scopedCareerClient>>['client']['createReview']>[0] | null = null
const pendingIntent = new Map<string, string>()
const intentId = (name: string) => { const id = pendingIntent.get(name) || crypto.randomUUID(); pendingIntent.set(name, id); return id }
const allStrategies = computed(() => { const result = [...strategies.value]; const current = review.value?.review?.strategy; if (current && !result.some(item => item.strategyId === current.strategyId)) result.unshift(current); return result })
type MetricRow = {key: string; label: string; numerator: number; denominator: number; rateLabel: string; readiness: string
    sampleIds: {numerator: string[]; denominator: string[]; excluded: string[]}; currentProgress: boolean}
const metricRows = computed<MetricRow[]>(() => {
    const stats = analytics.value
    if (!stats) return []
    const progress = (key: 'replied' | 'interviewed' | 'offers', label: string): MetricRow => ({
        key, label, numerator: stats.progressCounts[key], denominator: stats.progressCounts.contacted,
        rateLabel: progressRateLabel(stats.progressCounts[key], stats.progressCounts.contacted),
        readiness: stats.sampleSize ? `${stats.sampleSize} 条已满 ${stats.windowDays} 天，持续积累` : `记录已保存，等待满 ${stats.windowDays} 天`,
        sampleIds: {numerator: stats.progressSampleIds[key], denominator: stats.progressSampleIds.contacted, excluded: []}, currentProgress: true,
    })
    const resume = stats.metrics.resumeInterviewRate
    return [
        progress('replied', '收到回复'),
        progress('interviewed', '获得面试邀请'),
        {key: 'resumeInterviewRate', label: '发送简历后获得面试', numerator: resume.numerator, denominator: resume.denominator,
            rateLabel: metricRateLabel(resume), readiness: resume.denominator ? '已按确认的投递简历版本记录' : '等待确认投递时的简历版本',
            sampleIds: resume.sampleIds, currentProgress: false},
        progress('offers', '收到 Offer'),
    ]
})
const formatTime = (value: number | null) => value ? new Date(value).toLocaleString() : '无已确认记录'
const versionName = (version: ResumeVersion) => `${formatTime(version.createdAt)} · ${version.versionId.slice(0, 10)}`
const exposureLabel = (exposure: CareerApplication['resumeExposure']) => exposure.state === 'MIXED' ? '混合版本' : exposure.state === 'VERIFIED' && exposure.verificationKind === 'USER_CONFIRMED' ? '你已确认版本' : '未知'
const confirmationLabel = (value: string) => ({OBSERVED: '已观察', USER_CONFIRMED: '你已确认', INFERRED: '推断，未计入确认指标'} as Record<string, string>)[value] || value
const eventLabel = (value: string) => ({UNKNOWN: '尚未核实', OPEN: '尚无终局结果', CONTACT_INITIATED: '发起沟通', RESUME_SENT: '发送简历', HR_REPLIED: 'HR 回复', INTERVIEW_INVITED: '面试邀约', INTERVIEW_COMPLETED: '面试完成', REJECTED: '拒绝', OFFER_RECEIVED: '收到 Offer', WITHDRAWN: '撤回', CORRECTION: '纠正'} as Record<string, string>)[value] || value || '尚未核实'
const categoryLabel = (value: string) => ({MAIN: '主要方向', EXPLORE: '探索方向', PAUSE: '暂缓'} as Record<string, string>)[value] || value
function reset() {
    versions.value = []; applications.value = []; analytics.value = null; review.value = null; reviewJobs.value = []; strategies.value = []; deletion.value = null
    selectedPatches.value = {}; previews.value = {}; resumeText.value = ''; resumeFacts.value = ''; objective.value = ''; budget.value = undefined
    selection.value = {preparedResumeVersionId: null, strategyPlanId: null}; currentReviewId = ''; pendingIntent.clear(); reviewRequest = null
    sampleApplications.value = []; sampleMembership.value = {}; showSamples.value = false; sampleLabel.value = ''
    showEvent.value = false; eventApplication.value = null; eventRequest = null; eventQuote.value = ''; eventVersionId.value = ''; eventTime.value = null
    metricVersionId.value = ''; applicationOffset.value = 0; versionOffset.value = 0
}
async function operate(name: string, operation: (client: NonNullable<typeof session>['client']) => Promise<void>) {
    if (busy.value || !session) return
    busy.value = name; error.value = ''
    try { if (session.scope !== captureAutomationScope()) throw new Error('CAREER_SCOPE_CHANGED'); await operation(session.client); pendingIntent.delete(name) }
    catch { if (session?.scope !== captureAutomationScope()) { reset(); error.value = '账号或服务器已变化，请刷新当前记录。' } else error.value = '本次操作未确认。连接失败时可重试；若资料或偏好已变化，请刷新后重新预览、确认。' }
    finally { busy.value = '' }
}
async function load() {
    if (busy.value) return
    busy.value = 'load'; error.value = ''
    try {
        const next = await scopedCareerClient(); if (!session || session.scope !== next.scope) reset(); session = next
        const [v, a, s, j, selected, stats] = await Promise.all([next.client.versions(versionOffset.value), next.client.applications(applicationOffset.value), next.client.strategies(), next.client.reviews(), next.client.selection(), next.client.analytics(windowDays.value, Date.now(), metricVersionId.value)])
        if (disposed || next.scope !== captureAutomationScope()) return
        versions.value = v; applications.value = a; strategies.value = s; reviewJobs.value = j; selection.value = selected; analytics.value = stats
    } catch { error.value = '复盘服务尚未连接，未读取到记录；请确认服务状态后重试。' }
    finally { busy.value = '' }
}
const refreshAnalytics = () => operate('analytics', async client => { analytics.value = await client.analytics(windowDays.value, Date.now(), metricVersionId.value) })
const pageApplications = (delta: number) => operate('applications', async client => { const next = Math.max(0, applicationOffset.value + delta); applications.value = await client.applications(next); applicationOffset.value = next })
const pageVersions = (delta: number) => operate('versions', async client => { const next = Math.max(0, versionOffset.value + delta); versions.value = await client.versions(next); versionOffset.value = next })
const importHistory = () => operate('import', async client => { const result = await client.importLegacy(intentId('import')); applications.value = await client.applications(0); applicationOffset.value = 0; versions.value = await client.versions(0); versionOffset.value = 0; ElMessage.success(`已导入 ${result.importedApplications + result.importedSessionApplications} 条历史投递，补齐 ${result.importedContacts + result.importedSessionContacts} 次沟通和 ${result.importedSessionReplies} 条 HR 回复`) })
const createVersion = () => operate('create-version', async client => { const facts = resumeFacts.value.split('\n').map(value => value.trim()).filter(Boolean).map((text, index) => ({factId: `F${index + 1}`, text, verificationStatus: 'SOURCE_PRESENT' as const})); await client.createVersion(resumeText.value.trim(), facts); versions.value = await client.versions(0); versionOffset.value = 0; resumeText.value = ''; resumeFacts.value = ''; ElMessage.success('新准备版本已保存，尚未自动选择或发送') })
const selectVersion = (version: ResumeVersion) => { const name = `select:${version.versionId}:${selection.value.preparedResumeVersionId}`; return operate(name, async client => { await client.selectVersion(version.versionId, selection.value.preparedResumeVersionId, intentId(name)); selection.value = await client.selection(); ElMessage.success('下一轮准备版本已选择；平台附件未更换') }) }
async function copyVersion(version: ResumeVersion) { try { await navigator.clipboard.writeText(version.content); ElMessage.success('已复制文本') } catch { ElMessage.warning('复制不可用，可以在展开的文本中手动选择复制') } }
function downloadVersion(version: ResumeVersion) { const url = URL.createObjectURL(new Blob([version.content], {type: 'text/markdown;charset=utf-8'})); const link = document.createElement('a'); link.href = url; link.download = `resume-${version.versionId.slice(0, 16)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
function togglePatch(proposal: CareerProposal, patchId: string, checked: boolean) { const selected = selectedPatches.value[proposal.proposalId] || []; selectedPatches.value[proposal.proposalId] = checked ? [...new Set([...selected, patchId])] : selected.filter(id => id !== patchId); delete previews.value[proposal.proposalId] }
const previewProposal = (proposal: CareerProposal) => operate('preview', async client => { const result = await client.preview(proposal, [...(selectedPatches.value[proposal.proposalId] || [])]); if (previewMatchesSelection(result, proposal, selectedPatches.value[proposal.proposalId] || [])) previews.value[proposal.proposalId] = result })
const acceptProposal = (proposal: CareerProposal) => operate('accept-preview', async client => { const preview = previews.value[proposal.proposalId]; if (!previewMatchesSelection(preview, proposal, selectedPatches.value[proposal.proposalId] || [])) throw new Error('STALE_PREVIEW'); const result = await client.accept(preview); proposal.status = 'ACCEPTED'; proposal.acceptedVersionId = result.version.versionId; delete previews.value[proposal.proposalId]; versions.value = await client.versions(0); versionOffset.value = 0; ElMessage.success('已创建新版本；如需用于下一轮，请单独选择') })
async function pollReview() {
    if (!session || !currentReviewId || session.scope !== captureAutomationScope()) return
    const targetId = currentReviewId, targetSession = session
    const result = await targetSession.client.review(targetId)
    if (disposed || session !== targetSession || targetId !== currentReviewId || targetSession.scope !== captureAutomationScope()) return
    if ('checkpointDeleted' in result) { deletion.value = result; review.value = null; if (result.checkpointDeleted) currentReviewId = '' }
    else { review.value = result; deletion.value = null }
}
const openReview = (jobId: string) => operate('open-review', async () => { currentReviewId = jobId; selectedPatches.value = {}; previews.value = {}; await pollReview() })
const createReview = () => operate('create-review', async client => { if (!objective.value.trim() || !budget.value) return; const signature = JSON.stringify([objective.value.trim(), budget.value, windowDays.value, selection.value.preparedResumeVersionId]); if (!reviewRequest || JSON.stringify([reviewRequest.objective, reviewRequest.budget, reviewRequest.windowDays, reviewRequest.resumeVersionId]) !== signature) reviewRequest = {requestId: crypto.randomUUID(), windowDays: windowDays.value, cutoff: Date.now(), resumeVersionId: selection.value.preparedResumeVersionId, objective: objective.value.trim(), budget: budget.value, hardConstraints: {}}; const job = await client.createReview(reviewRequest); currentReviewId = job.jobId; reviewJobs.value = [job, ...reviewJobs.value.filter(value => value.jobId !== job.jobId)]; await pollReview(); reviewRequest = null })
const confirmReview = (decision: 'CONFIRM' | 'IGNORE') => operate('review-confirmation', async client => { if (!review.value) return; await client.confirmReview(review.value.job, decision); await pollReview(); ElMessage.success('复盘反馈已保存，等待流程完成') })
async function deleteReview() { if (!review.value || busy.value) return; const jobId = review.value.job.jobId; try { await ElMessageBox.confirm('删除这次私密复盘、草稿和流程检查点？历史投递事实及被引用的版本会保留。', '删除复盘', {confirmButtonText: '删除本次复盘', cancelButtonText: '取消', type: 'warning'}) } catch { return }; await operate('delete-review', async client => { deletion.value = await client.deleteReview(jobId); review.value = null; currentReviewId = deletion.value.checkpointDeleted ? '' : jobId; reviewJobs.value = reviewJobs.value.filter(job => job.jobId !== jobId) }) }
const approveStrategy = (strategy: CareerStrategy) => operate('approve-strategy', async client => { const result = await client.approveStrategy(strategy); Object.assign(strategy, result); ElMessage.success('策略已批准，尚未应用') })
const applyStrategy = (strategy: CareerStrategy) => { const name = `apply:${strategy.strategyId}`; return operate(name, async client => { const result = await client.applyStrategy(strategy, intentId(name)); Object.assign(strategy, result); selection.value = await client.selection(); ElMessage.success('已选择下一轮策略；投递与自动回复开关保持原状态') }) }
const drilldown = (row: MetricRow) => operate('samples', async client => { const ids = [...new Set([...row.sampleIds.denominator, ...row.sampleIds.excluded])]; sampleLabel.value = row.currentProgress ? `共 ${ids.length} 条已发起沟通记录，其中 ${row.numerator} 条达到这项结果。最多显示前 ${Math.min(50, ids.length)} 条。` : `共找到 ${ids.length} 条简历版本相关记录：${row.numerator} 条达到这项结果，${row.denominator} 条证据完整。最多显示前 ${Math.min(50, ids.length)} 条。`; sampleMembership.value = Object.fromEntries(ids.map(id => [id, row.sampleIds.excluded.includes(id) ? '等待确认投递时的简历版本' : row.sampleIds.numerator.includes(id) ? '达到这项结果' : row.currentProgress ? '持续观察中' : '版本证据已确认'])); sampleApplications.value = await Promise.all(ids.slice(0, 50).map(id => client.application(id))); showSamples.value = true })
function openEvent(application: CareerApplication, supersedes: string | null = null) {
    eventApplication.value = application; eventSupersedes.value = supersedes; eventRequest = null
    eventType.value = supersedes ? 'CORRECTION' : 'HR_REPLIED'; eventTime.value = null; eventQuote.value = ''; eventVersionId.value = ''
    eventConfirmation.value = 'USER_CONFIRMED'; showEvent.value = true; error.value = ''
}
const saveEvent = () => operate('save-event', async client => {
    const application = eventApplication.value, occurredAt = eventTime.value?.getTime()
    if (!application || !occurredAt || occurredAt > Date.now() || !eventQuote.value.trim()) throw new Error('ACTUAL_EVENT_REQUIRED')
    const version = eventType.value === 'RESUME_SENT' ? versions.value.find(item => item.versionId === eventVersionId.value) : null
    const material = {eventType: eventType.value, occurredAt, evidence: {source: eventConfirmation.value === 'USER_CONFIRMED' ? 'USER_CONFIRMATION' as const : 'USER_NOTE' as const,
        referenceId: eventSupersedes.value, quote: eventQuote.value.trim(), ...(version ? {resumeVersionId: version.versionId, contentHash: version.contentHash} : {})},
        confirmation: eventConfirmation.value, supersedesEventId: eventSupersedes.value}
    if (!eventRequest || JSON.stringify({...eventRequest, requestId: undefined}) !== JSON.stringify(material)) eventRequest = {requestId: crypto.randomUUID(), ...material}
    await client.appendEvent(application.applicationId, eventRequest)
    const refreshed = await client.application(application.applicationId)
    applications.value = applications.value.map(item => item.applicationId === refreshed.applicationId ? refreshed : item)
    analytics.value = await client.analytics(windowDays.value, Date.now(), metricVersionId.value)
    eventRequest = null; showEvent.value = false; ElMessage.success('事实已追加，历史记录保留；没有发送消息或附件')
})
onMounted(() => { void load(); timer = setInterval(() => { if (busy.value) return; if (session && session.scope !== captureAutomationScope()) { reset(); session = null; error.value = '账号或服务器已变化，请刷新当前记录。'; return }; if (currentReviewId && (!review.value || !['COMPLETED', 'FAILED', 'CANCELLED'].includes(review.value.job.status))) void pollReview().catch(() => { error.value = '任务状态暂未更新，保留已保存内容。' }) }, 3000) })
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer) })
</script>
<style scoped>
.career-workspace{color:#243b33;font-size:14px;min-width:0;overflow-wrap:anywhere}.career-note{color:#52655d;line-height:1.6}.career-warning{color:#87551a}.career-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.career-controls label{display:flex;gap:8px;align-items:center;max-width:100%}
.career-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}.career-summary article{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid #d9e5df;border-radius:7px;background:#f8fbfa}.career-summary strong{font-size:20px}.career-summary span{color:#52655d}.career-guidance{padding:10px 12px;border-left:3px solid #67b587;background:#f4faf6;line-height:1.6}.career-basis{margin-top:16px}
.career-workspace details{border-top:1px solid #d9e5df;margin:12px 0;padding:12px 0}.career-workspace summary{font-weight:600;cursor:pointer;overflow-wrap:anywhere}.career-workspace pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f7f5;padding:12px;font:inherit;line-height:1.6}.career-workspace blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid #9bbaac;background:#f6f8f7;white-space:pre-wrap;overflow-wrap:anywhere}.career-workspace label{display:block;margin:10px 0}.career-table{width:100%;border-collapse:collapse;font-size:13px}.career-table th,.career-table td{border-bottom:1px solid #d9e5df;text-align:left;padding:8px;overflow-wrap:anywhere}.career-proposal{padding:12px;margin:12px 0;border:1px solid #d9e5df;border-radius:6px}.career-patch{border-top:1px solid #e2e9e5;padding:12px 0}.career-comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}.career-comparison>div{min-width:0}@media(max-width:600px){.career-comparison{grid-template-columns:1fr}.career-table th,.career-table td{padding:5px}.career-controls label{display:block;width:100%}}
</style>
