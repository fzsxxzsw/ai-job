<template>
    <br/>
    <div class="chat-action-bar">
        <el-button type="success" @click="handlerClick">恢复当前会话 AI 回复</el-button>
        <el-button type="primary" plain :loading="rejectionAnalysisLoading" @click="handleAnalyzeRejection">
            分析这次拒绝
        </el-button>
        <el-tag :type="userStore.user.aiSeatStatus ? 'success' : 'info'" effect="plain">
            AI 回复{{ userStore.user.aiSeatStatus ? '已启用' : '未启用' }}
        </el-tag>
        <el-tag :type="chatChannelReady ? 'success' : 'danger'" effect="plain">
            消息通道{{ chatChannelReady ? '已连接' : '未连接' }}
        </el-tag>
        <el-tag type="info" effect="plain">脚本 {{ runtimeScriptVersion }}</el-tag>
    </div>

    <div class="chat-health-panel">
        <span class="health-panel-title">消息处理</span>
        <el-tag :type="pendingGreetingCount > 0 ? 'warning' : 'success'" effect="plain">
            招呼待发送/重试 {{ pendingGreetingCount }}
        </el-tag>
        <el-tag :type="pendingAiReplyCount > 0 ? 'warning' : 'success'" effect="plain">
            AI 回复待发送/重试 {{ pendingAiReplyCount }}
        </el-tag>
        <el-tag :type="greetingAwaitingReceiptCount > 0 ? 'warning' : 'success'" effect="plain">
            招呼待页面回执 {{ greetingAwaitingReceiptCount }}
        </el-tag>
        <el-tag :type="aiReplyAwaitingReceiptCount > 0 ? 'warning' : 'success'" effect="plain">
            AI 回复待页面回执 {{ aiReplyAwaitingReceiptCount }}
        </el-tag>
        <el-tag v-if="deliveryFailedCount > 0" type="danger" effect="plain">
            发送失败 {{ deliveryFailedCount }}
        </el-tag>
        <el-tag v-if="deliveryBlockedCount > 0" type="danger" effect="plain">
            已拦截 {{ deliveryBlockedCount }}
        </el-tag>
        <el-tag type="success" effect="plain">招呼已送达/已读 {{ greetingReceiptCount }}</el-tag>
        <el-tag type="success" effect="plain">AI 回复已送达/已读 {{ aiReplyReceiptCount }}</el-tag>
        <el-tag v-if="ungreetedConversationCount > 0" type="danger" effect="plain">
            会话仅创建未发招呼 {{ ungreetedConversationCount }}
        </el-tag>
        <el-tag v-if="obscuredUnreadCount > 0" type="danger" effect="plain">
            未读内容被系统消息遮挡 {{ obscuredUnreadCount }}
        </el-tag>
        <el-tag v-if="unresolvedUnreadCount > 0" type="danger" effect="plain">
            未读联系人待恢复 {{ unresolvedUnreadCount }}
        </el-tag>
        <el-tag v-if="hookDuplicateStarts > 0" type="danger" effect="plain">
            已拦截重复坐席 {{ hookDuplicateStarts }} 次
        </el-tag>
    </div>

    <div v-if="riskStopReason" class="chat-risk-alert chat-risk-panel">
        <el-alert title="BOSS 风控熔断已生效，自动发送已停止"
                  :description="riskStopReason" type="error" :closable="false" show-icon/>
        <div class="chat-risk-actions">
            <span>关闭 AI 回复并确认投递已停止后，才可解除旧熔断。</span>
            <el-button type="warning" plain size="small" @click="handleClearRiskStop">
                确认已恢复，解除熔断
            </el-button>
        </div>
    </div>
    
    <!-- 批量发送悬浮框（自定义非遮罩，不阻塞背景点击） -->
    <div v-if="batchSendDialogVisible" class="batch-send-float">
        <el-input
            v-model="batchMessageText"
            type="textarea"
            :rows="4"
            placeholder="请输入要发送的消息内容"
        />
        <div class="dialog-footer" style="margin-top: 10px; text-align: right;">
            <el-button @click="onCancel">取消</el-button>
            <el-button type="primary" @click="sendBatchMessage">发送</el-button>
        </div>
    </div>

    <Teleport to="body">
        <aside v-if="rejectionCardVisible && rejectionAnalysis" class="rejection-analysis-card">
            <div class="rejection-card-header">
                <div>
                    <strong>拒绝分析</strong>
                    <el-tag size="small" effect="plain">{{ rejectionStatusLabel(rejectionAnalysis.status) }}</el-tag>
                </div>
                <el-button text aria-label="关闭拒绝分析" @click="rejectionCardVisible = false">关闭</el-button>
            </div>

            <section class="rejection-card-section">
                <h4>HR 明确原因</h4>
                <p v-if="rejectionAnalysis.explicitReasons.length === 0" class="rejection-unknown">未知</p>
                <div v-for="(finding, index) in rejectionAnalysis.explicitReasons"
                     :key="`explicit-${finding.code}-${index}`" class="rejection-finding">
                    <div><strong>{{ finding.label || finding.code }}</strong><el-tag size="small" type="success">明确</el-tag></div>
                    <p>{{ finding.reason }}</p>
                    <small v-if="finding.evidenceIds?.length">证据：{{ finding.evidenceIds.join('、') }}</small>
                </div>
            </section>

            <section class="rejection-card-section">
                <h4>推断风险</h4>
                <p v-if="rejectionAnalysis.inferredRisks.length === 0" class="rejection-unknown">暂无可验证推断</p>
                <div v-for="(finding, index) in rejectionAnalysis.inferredRisks"
                     :key="`inferred-${finding.code}-${index}`" class="rejection-finding">
                    <div><strong>{{ finding.label || finding.code }}</strong><el-tag size="small" type="warning">推断</el-tag></div>
                    <p>{{ finding.reason }}</p>
                    <small v-if="finding.evidenceIds?.length">证据：{{ finding.evidenceIds.join('、') }}</small>
                </div>
            </section>

            <section class="rejection-card-section">
                <h4>未知信息</h4>
                <p v-if="rejectionAnalysis.unknowns.length === 0" class="rejection-unknown">暂无</p>
                <ul v-else><li v-for="item in rejectionAnalysis.unknowns" :key="item">{{ item }}</li></ul>
            </section>

            <section v-if="rejectionAnalysis.status === 'CORRECTED' && rejectionAnalysis.correctedReason"
                     class="rejection-card-section">
                <h4>你的纠正</h4>
                <p>{{ rejectionAnalysis.correctedReason }}</p>
            </section>

            <section class="rejection-card-section">
                <h4>证据</h4>
                <p v-if="rejectionAnalysis.evidence.length === 0" class="rejection-unknown">没有可引用证据</p>
                <dl v-else class="rejection-evidence-list">
                    <template v-for="evidence in rejectionAnalysis.evidence" :key="evidence.id">
                        <dt>{{ evidence.id }} · {{ evidence.source }}</dt>
                        <dd>{{ evidence.text }}</dd>
                    </template>
                </dl>
            </section>

            <section class="rejection-card-section">
                <h4>可立即调整事项</h4>
                <p v-if="rejectionAnalysis.suggestions.length === 0" class="rejection-unknown">本次没有可靠建议</p>
                <ol v-else><li v-for="suggestion in rejectionAnalysis.suggestions" :key="suggestion">{{ suggestion }}</li></ol>
            </section>

            <section v-if="shouldShowRejectionSummary(rejectionSummary)" class="rejection-card-section rejection-trend">
                <h4>个人趋势（{{ rejectionSummary?.totalConfirmed }} 个确认案例）</h4>
                <span v-for="(count, category) in rejectionSummary?.categoryCounts"
                      :key="category" class="rejection-trend-item">{{ category }} {{ count }}</span>
            </section>

            <details class="rejection-card-section rejection-diagnostics" @toggle="refreshRejectionDiagnostics">
                <summary>诊断信息（仅安全元数据）</summary>
                <dl class="rejection-diagnostic-metadata">
                    <dt>分析 / 快照 ID</dt>
                    <dd>{{ rejectionAnalysis.id }} / {{ rejectionAnalysis.applicationSnapshotId || '-' }}</dd>
                    <dt>来源 / 状态</dt>
                    <dd>{{ rejectionAnalysis.analysisSource || '-' }} / {{ rejectionAnalysis.status || '-' }}</dd>
                    <dt>模型 / Prompt</dt>
                    <dd>{{ rejectionAnalysis.model || '-' }} / {{ rejectionAnalysis.promptVersion || '-' }}</dd>
                    <dt>对话完整度</dt>
                    <dd>{{ rejectionAnalysis.conversationCompleteness || '-' }}</dd>
                </dl>
                <div class="rejection-diagnostic-actions">
                    <el-button size="small" plain @click="refreshRejectionDiagnostics">刷新</el-button>
                    <el-button size="small" plain @click="copyRejectionDiagnostics">复制诊断摘要</el-button>
                    <el-button size="small" plain @click="clearRejectionDiagnostics">清空时间线</el-button>
                </div>
                <p v-if="rejectionDiagnostics.events.length === 0" class="rejection-unknown">暂无诊断事件</p>
                <ol v-else class="rejection-diagnostic-events">
                    <li v-for="event in rejectionDiagnostics.events.slice(-12).reverse()" :key="event.sequence">
                        <code>#{{ event.sequence }} {{ event.stage }} / {{ event.outcome }}</code>
                        <span v-if="event.durationMs !== undefined">{{ event.durationMs }}ms</span>
                        <span v-if="event.errorClass">{{ event.errorClass }}</span>
                        <span v-if="event.messageCount !== undefined">消息 {{ event.messageCount }}</span>
                        <span v-if="event.attempt !== undefined">第 {{ event.attempt }} 次</span>
                    </li>
                </ol>
                <small>不会记录或复制对话、JD、简历、证据、拒绝原因和 BOSS 标识。</small>
            </details>

            <div class="rejection-card-actions">
                <el-button type="success" :loading="rejectionFeedbackLoading" @click="handleRejectionFeedback('CONFIRM')">
                    确认
                </el-button>
                <el-button type="warning" plain :loading="rejectionFeedbackLoading" @click="handleRejectionFeedback('CORRECT')">
                    纠正原因
                </el-button>
                <el-button :loading="rejectionFeedbackLoading" @click="handleRejectionFeedback('IGNORE')">忽略</el-button>
            </div>
            <small class="rejection-completeness">当前页对话可能不完整；结论不会自动修改简历或投递策略。</small>
        </aside>
    </Teleport>
</template>

<script setup lang="ts">
import {AiPower} from "../../platform/aiPower";
import {ElMessage} from "../../utils/tools";
import {BossOption} from "../../platform/bossPlatform";
import {onMounted, onUnmounted, ref} from "vue";
import {Message} from "../../webSocket/protobuf";
import {Tools} from "../../platform/utils";
import {GM_getValue, GM_info} from "$";
import {
    backfillVisibleGreetingReceipts,
    getSelectedConversationIdentity,
    reconcileDeliveryAuditFromDom,
} from "../../platform/deliveryAudit";
import {UserStore} from "../../stores";
import {countBlockingDeliveries, type RetryQueueEntry} from "../../platform/deliveryQueue";
import {clearBossRiskCircuit, getBossRiskStop} from "../../platform/bossRiskControl";
import {PushRunStore} from "../../stores/pushRun";
import {ElMessageBox} from "element-plus";
import {
    analyzeRejection,
    buildRejectionAnalyzePayload,
    collectVisibleRejectionMessages,
    getRejectionSummary,
    readConversationRejectionMessages,
    type RejectionAnalysisVO,
    type RejectionFeedbackAction,
    type RejectionSummary,
    shouldApplyAnalysisResult,
    shouldShowRejectionSummary,
    submitRejectionFeedback,
} from "../../platform/boss/rejectionAnalysis";
import {
    buildSafeRejectionDiagnosticReport,
    clearRejectionDebugEvents,
    getRejectionDebugSnapshot,
    installRejectionDebugBridge,
    type RejectionDebugSnapshot,
} from "../../platform/boss/rejectionDebug";

const userStore = UserStore()
const pushRunStore = PushRunStore()
const runtimeStatus = Tools.window.__AI_JOB_HELPER_RUNTIME_STATUS__
installRejectionDebugBridge(Tools.window)
const runtimeScriptVersion = [
    runtimeStatus?.version || GM_info?.script?.version || '未知版本',
    runtimeStatus?.buildId ? `build ${runtimeStatus.buildId}` : '',
].filter(Boolean).join(' · ')
const chatChannelReady = ref(false)
const pendingGreetingCount = ref(0)
const ungreetedConversationCount = ref(0)
const pendingAiReplyCount = ref(0)
const obscuredUnreadCount = ref(0)
const unresolvedUnreadCount = ref(0)
const greetingAwaitingReceiptCount = ref(0)
const greetingReceiptCount = ref(0)
const aiReplyAwaitingReceiptCount = ref(0)
const aiReplyReceiptCount = ref(0)
const deliveryFailedCount = ref(0)
const deliveryBlockedCount = ref(0)
const hookDuplicateStarts = ref(0)
const riskStopReason = ref('')
const rejectionAnalysisLoading = ref(false)
const rejectionFeedbackLoading = ref(false)
const rejectionCardVisible = ref(false)
const rejectionAnalysis = ref<RejectionAnalysisVO | null>(null)
const rejectionSummary = ref<RejectionSummary | null>(null)
const rejectionConversationKey = ref('')
const rejectionDiagnostics = ref<RejectionDebugSnapshot>(getRejectionDebugSnapshot())
let healthTimer: number | null = null
let batchButtonTimer: number | null = null

const refreshChatHealth = () => {
    chatChannelReady.value = !!Tools.window.AIJobHelperChatBridge?.isReady?.()
    const readQueue = (key: string): RetryQueueEntry[] => {
        try {
            const gmQueue = GM_getValue(key, '') as string
            const queue = JSON.parse(gmQueue || localStorage.getItem(key) || '[]')
            return Array.isArray(queue) ? queue.filter(item => item?.key) : []
        } catch (_) {
            return []
        }
    }
    pendingGreetingCount.value = countBlockingDeliveries(readQueue('ai-job-pending-greetings-v1'))
    pendingAiReplyCount.value = countBlockingDeliveries(
        readQueue('ai-job-pending-ai-replies-v1'),
        Number.POSITIVE_INFINITY,
    )
    const configuredGreeting = userStore.user?.preference?.cg || ''
    backfillVisibleGreetingReceipts(configuredGreeting)
    const audit = reconcileDeliveryAuditFromDom()
    greetingAwaitingReceiptCount.value = audit.filter(item => item.kind === 'greeting'
        && item.status === 'acknowledged').length
    greetingReceiptCount.value = audit.filter(item => item.kind === 'greeting' && item.status === 'receipt'
        && !!item.bossId && !!item.conversationKey && !!item.clientMid && !!item.serverMid).length
    aiReplyAwaitingReceiptCount.value = audit.filter(item => item.kind === 'ai-reply'
        && item.status === 'acknowledged').length
    aiReplyReceiptCount.value = audit.filter(item => item.kind === 'ai-reply'
        && item.status === 'receipt' && !!item.bossId && !!item.conversationKey
        && !!item.clientMid && !!item.serverMid).length
    deliveryFailedCount.value = audit.filter(item => item.status === 'failed').length
    deliveryBlockedCount.value = audit.filter(item => item.status === 'blocked').length
    const unreadHealth = BossOption.getUnreadRecoveryHealth()
    obscuredUnreadCount.value = unreadHealth.obscured
    unresolvedUnreadCount.value = unreadHealth.unresolved
    ungreetedConversationCount.value = Array.from(document.querySelectorAll('.friend-content-warp, li')).filter(item => {
        const text = item.textContent || ''
        return text.includes('您正在与Boss') && !text.includes('[草稿]')
            && !Tools.isHardBlockedCompany(text, text)
    }).length
    hookDuplicateStarts.value = Number(Tools.window.__AI_JOB_HELPER_WS_HOOK_V2__?.duplicateStarts || 0)
    riskStopReason.value = getBossRiskStop()?.reason || ''
}

// 批量发送相关状态
const batchSendDialogVisible = ref(false)
const batchMessageText = ref('')

// 统一清理批量UI
const cleanupBatchUI = () => {
    const checkboxes = document.querySelectorAll('.batch-checkbox')
    checkboxes.forEach(checkbox => (checkbox as HTMLElement).remove())
    const selectedElements = document.querySelectorAll('.batch-send-item')
    selectedElements.forEach(element => element.classList.remove('batch-send-item'))
}

const onCancel = () => {
    batchSendDialogVisible.value = false
    cleanupBatchUI()
    batchMessageText.value = ''
}

function rejectionStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        CONFIRMED: '已确认',
        CORRECTED: '已纠正',
        IGNORED: '已忽略',
        PENDING: '待确认',
        ANALYZED: '待确认',
    }
    return labels[String(status || '').toUpperCase()] || '待确认'
}

const refreshRejectionDiagnostics = () => {
    rejectionDiagnostics.value = getRejectionDebugSnapshot()
}

const copyRejectionDiagnostics = async () => {
    refreshRejectionDiagnostics()
    const report = buildSafeRejectionDiagnosticReport({
        runtime: {
            version: runtimeStatus?.version || GM_info?.script?.version,
            buildId: runtimeStatus?.buildId,
        },
        analysis: rejectionAnalysis.value,
    })
    const text = JSON.stringify(report, null, 2)
    try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await navigator.clipboard.writeText(text)
    } catch (_) {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
    }
    ElMessage.success('安全诊断摘要已复制')
}

const clearRejectionDiagnostics = () => {
    clearRejectionDebugEvents()
    refreshRejectionDiagnostics()
    ElMessage.success('拒绝分析诊断时间线已清空')
}

function resolveCurrentRejectionContext(): {
    bossId: string
    conversationKey: string
    encryptJobId: string
} | null {
    const identity = getSelectedConversationIdentity(document)
    if (!identity) return null
    const numericBossId = Number(identity.bossId)
    const selectedRow = document.querySelector(
        '.friend-content.selected, .friend-content-warp.selected, li.selected .friend-content, li[aria-current="true"] .friend-content',
    ) as HTMLElement | null
    const visibleConversationText = [
        selectedRow?.closest('li')?.textContent,
        (document.querySelector('.top-info-content') as HTMLElement | null)?.textContent,
    ].filter(Boolean).join('\n')
    const cachedContact = Number.isFinite(numericBossId)
        ? BossOption.getBossUserInfoByCache(numericBossId)
        : undefined
    const contact = cachedContact || BossOption.findContactByRowText(visibleConversationText)
    const encryptJobId = String(contact?.encryptJobId ?? '').trim()
    return encryptJobId ? {
        bossId: identity.bossId,
        conversationKey: identity.conversationKey,
        encryptJobId,
    } : null
}

const handleAnalyzeRejection = async () => {
    const context = resolveCurrentRejectionContext()
    if (!context) {
        ElMessage.warning('未能同时识别当前联系人和职位，请先进入目标聊天后重试')
        return
    }
    const payload = buildRejectionAnalyzePayload({
        encryptJobId: context.encryptJobId,
        conversationKey: context.conversationKey,
        bufferedMessages: readConversationRejectionMessages(context.conversationKey, context.bossId),
        visibleMessages: collectVisibleRejectionMessages(document),
    })
    if (payload.messages.length === 0) {
        ElMessage.info('当前页面没有可分析的对话消息，请展开拒绝对话后重试')
        return
    }

    rejectionAnalysisLoading.value = true
    try {
        const result = await analyzeRejection(payload)
        const currentConversationKey = getSelectedConversationIdentity(document)?.conversationKey || ''
        if (!shouldApplyAnalysisResult(context.conversationKey, currentConversationKey)) {
            ElMessage.info('分析已完成，但当前会话已切换；为避免串会话，本次结果未打开')
            return
        }
        rejectionConversationKey.value = context.conversationKey
        rejectionAnalysis.value = result
        rejectionSummary.value = null
        rejectionCardVisible.value = true
    } finally {
        refreshRejectionDiagnostics()
        rejectionAnalysisLoading.value = false
    }
}

const handleRejectionFeedback = async (action: RejectionFeedbackAction) => {
    if (!rejectionAnalysis.value?.id) return
    const payload: {action: RejectionFeedbackAction, correctedReason?: string, correctedCode?: string} = {action}
    if (action === 'CORRECT') {
        try {
            const prompt = await ElMessageBox.prompt(
                '请输入你认为更准确的拒绝原因。纠正后的原因才会进入个人趋势。',
                '纠正拒绝原因',
                {
                    confirmButtonText: '提交纠正',
                    cancelButtonText: '取消',
                    inputPattern: /\S+/,
                    inputErrorMessage: '请输入纠正原因',
                },
            )
            payload.correctedReason = prompt.value.trim()
            payload.correctedCode = 'USER_CORRECTION'
        } catch (_) {
            return
        }
    }

    rejectionFeedbackLoading.value = true
    try {
        const updated = await submitRejectionFeedback(rejectionAnalysis.value.id, payload)
        const currentConversationKey = getSelectedConversationIdentity(document)?.conversationKey || ''
        if (shouldApplyAnalysisResult(rejectionConversationKey.value, currentConversationKey)) {
            rejectionAnalysis.value = updated
            ElMessage.success(action === 'IGNORE' ? '已忽略本次分析' : '反馈已保存')
        } else {
            rejectionCardVisible.value = false
        }
        try {
            rejectionSummary.value = await getRejectionSummary()
        } catch (_) {
            rejectionSummary.value = null
        }
    } finally {
        refreshRejectionDiagnostics()
        rejectionFeedbackLoading.value = false
    }
}

const handleClearRiskStop = async () => {
    if (pushRunStore.isActive) {
        ElMessage.warning('请先到“AI 助手”页面停止当前投递任务')
        return
    }
    if (userStore.user.aiSeatStatus) {
        ElMessage.warning('请先到“AI 助手”页面关闭“AI 回复”开关')
        return
    }

    try {
        await ElMessageBox.confirm(
            '仅当你已在 BOSS 官方页面确认账号恢复正常时解除。解除后不会自动启动投递或 AI 回复。',
            '解除本地风控熔断',
            {
                confirmButtonText: '确认解除',
                cancelButtonText: '取消',
                type: 'warning',
            },
        )
    } catch (_) {
        return
    }

    if (!clearBossRiskCircuit()) {
        ElMessage.error('本地熔断状态清除失败，请刷新页面后重试')
        return
    }
    riskStopReason.value = ''
    ElMessage.success('本地风控熔断已解除；自动发送仍保持停止')
}

// 检查并创建批量发送按钮
const checkAndCreateBatchSendButton = () => {
    const labelList = document.querySelector('.label-list')
    if (!labelList) return
    
    // 检查是否已存在批量发送按钮
    const existingButton = labelList.querySelector('.batch-send-btn')
    if (existingButton) return
    
    // 创建批量发送按钮
    const batchSendButton = document.createElement('button')
    batchSendButton.className = 'batch-send-btn'
    batchSendButton.innerHTML = '批量发送消息'
    batchSendButton.style.cssText = `
        margin: 10px 0px;
        padding: 8px 8px;
        background-color: #6ead34;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `
    
    // 添加点击事件
    batchSendButton.addEventListener('click', () => {
        addCheckboxesToItems()
        batchSendDialogVisible.value = true
    })
    
    labelList.appendChild(batchSendButton)
}

// 为所有friend-content-warp元素添加勾选框
const addCheckboxesToItems = () => {
    const items = document.querySelectorAll('.friend-content-warp')
    
    items.forEach((item) => {
        // 检查是否已存在勾选框
        if (item.querySelector('.batch-checkbox')) return
        
        // 创建勾选框
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'batch-checkbox'
        checkbox.style.cssText = `
            margin-right: 8px;
            transform: scale(1.2);
        `
        // 阻止冒泡，避免触发父节点点击
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation()
        })
        
        // 添加勾选事件
        checkbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement
            e.stopPropagation()
            if (target.checked) {
                item.classList.add('batch-send-item')
            } else {
                item.classList.remove('batch-send-item')
            }
        })

        // 将勾选框插入到元素的最前面
        let firstElementChild = item.firstElementChild as any;
        firstElementChild.insertBefore(checkbox, firstElementChild.firstChild)
    })
}

// 发送批量消息
const sendBatchMessage = async () => {
    if (!batchMessageText.value.trim()) {
        ElMessage({
            type: 'warning',
            message: '请输入消息内容'
        })
        return
    }
    
    const selectedItems = document.querySelectorAll('.friend-content-warp.batch-send-item')
    
    if (selectedItems.length === 0) {
        ElMessage({
            type: 'warning',
            message: '请至少选择一个联系人'
        })
        return
    }
    if (selectedItems.length > 1) {
        ElMessage({
            type: 'warning',
            message: '安全模式每次只允许向一个联系人发送消息'
        })
        return
    }
    
    let confirmed = 0
    let failed = 0
    let blocked = 0
    // 每条消息都等待真实聊天通道 ACK；不能再把“调用了 send”冒充为发送成功。
    for (const item of Array.from(selectedItems)) {
        const rowText = (item as HTMLElement).innerText || item.textContent || ''
        if (Tools.isHardBlockedCompany(rowText, rowText)) {
            blocked += 1
            continue
        }
        const vueInstance = (item as any).__vue__
        if (vueInstance && vueInstance.source) {
            const to_uid = vueInstance.source.uid
            const to_name = vueInstance.source.encryptBossId
            
            if (to_uid && to_name) {
                const message = new Message({
                    form_uid: Tools.window._PAGE.uid.toString(),
                    to_uid: to_uid.toString(),
                    to_name: to_name,
                    content: batchMessageText.value,
                    image: undefined,
                })
                if (await message.send(1, 1_000)) confirmed += 1
                else failed += 1
            }
        } else {
            failed += 1
        }
    }
    
    ElMessage({
        duration: 3000,
        type: failed > 0 ? 'warning' : 'success',
        message: `批量消息通道确认 ${confirmed} 条，失败 ${failed} 条，硬屏蔽 ${blocked} 条`
    })
    
    // 清理状态
    batchMessageText.value = ''
    batchSendDialogVisible.value = false
    cleanupBatchUI()
}

onMounted(() => {
    refreshChatHealth()
    healthTimer = window.setInterval(refreshChatHealth, 1000)
    // 风控安全模式不再自动创建“批量发送消息”入口。
})

onUnmounted(() => {
    if (healthTimer !== null) window.clearInterval(healthTimer)
    if (batchButtonTimer !== null) window.clearInterval(batchButtonTimer)
    cleanupBatchUI()
})

const handlerClick = () => {

    const element = document.querySelector('.friend-content.selected') as any;
    const legacyEncryptJobId = element?.parentElement?.__vue__?.source?.encryptJobId;
    const visibleConversationText = [
        element?.closest('li')?.innerText,
        (document.querySelector('.top-info-content') as HTMLElement | null)?.innerText,
    ].filter(Boolean).join('\n')
    const recoveredContact = BossOption.findContactByRowText(visibleConversationText)
    const jobKey = legacyEncryptJobId
        ? BossOption.buildJobKey({encryptJobId: legacyEncryptJobId} as any)
        : recoveredContact
            ? BossOption.buildJobKey(recoveredContact)
            : ''
    if (!jobKey) {
        ElMessage({
            type: 'info',
            message: '未识别当前联系人，请先进入聊天窗口后重试'
        })
        return;
    }

    AiPower.updateAskStatus(jobKey, false).then(_ => {
        ElMessage({
            type: 'success',
            message: '已重新触发AI坐席'
        })
    })
}

</script>

<style scoped>
.chat-action-bar,
.chat-health-panel {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 10px 10px;
}

.chat-health-panel {
    padding: 10px 12px;
    border: 1px solid #dcdfe6;
    border-radius: 8px;
    background: #f5f7fa;
}

.health-panel-title {
    margin-right: 4px;
    color: #303133;
    font-weight: 600;
}

.chat-risk-alert {
    margin: 0 10px 10px;
}

.chat-risk-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    color: #7a4b00;
    background: #fdf6ec;
    border: 1px solid #faecd8;
    border-top: 0;
    border-radius: 0 0 4px 4px;
}

.batch-send-btn:hover {
    background-color: #337ecc !important;
}

.batch-checkbox {
    margin-right: 8px;
    transform: scale(1.2);
}

.batch-send-item {
    background-color: #f0f9ff !important;
    border: 2px solid #409eff !important;
}

.batch-send-float {
    position: fixed;
    right: 24px;
    bottom: 24px;
    width: 480px;
    padding: 16px;
    background: #ffffff;
    box-shadow: 0 6px 16px rgba(0,0,0,0.15);
    border-radius: 8px;
    z-index: 9999;
}

.rejection-analysis-card {
    position: fixed;
    top: 72px;
    right: 24px;
    z-index: 2147483000;
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 96px);
    overflow: auto;
    padding: 18px;
    color: #303133;
    background: #fff;
    border: 1px solid #dcdfe6;
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, .22);
}

.rejection-card-header,
.rejection-card-header > div,
.rejection-finding > div,
.rejection-card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.rejection-card-header {
    justify-content: space-between;
    margin-bottom: 12px;
}

.rejection-card-section {
    padding: 10px 0;
    border-top: 1px solid #ebeef5;
}

.rejection-card-section h4,
.rejection-card-section p,
.rejection-card-section ul,
.rejection-card-section ol,
.rejection-card-section dl {
    margin: 6px 0;
}

.rejection-card-section li,
.rejection-finding p,
.rejection-evidence-list dd {
    line-height: 1.55;
}

.rejection-finding + .rejection-finding {
    margin-top: 10px;
}

.rejection-finding small,
.rejection-completeness,
.rejection-unknown {
    color: #909399;
}

.rejection-evidence-list dt {
    margin-top: 8px;
    color: #606266;
    font-weight: 600;
}

.rejection-evidence-list dd {
    margin-left: 0;
    overflow-wrap: anywhere;
}

.rejection-trend-item {
    display: inline-block;
    margin: 3px 8px 3px 0;
    padding: 3px 8px;
    background: #f0f9eb;
    border-radius: 10px;
}

.rejection-diagnostics summary {
    cursor: pointer;
    color: #606266;
    font-weight: 600;
}

.rejection-diagnostic-metadata {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 4px 10px;
    font-size: 12px;
}

.rejection-diagnostic-metadata dt {
    color: #909399;
}

.rejection-diagnostic-metadata dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.rejection-diagnostic-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0;
}

.rejection-diagnostic-actions .el-button + .el-button {
    margin-left: 0;
}

.rejection-diagnostic-events {
    max-height: 180px;
    overflow: auto;
    padding-left: 20px;
    font-size: 12px;
}

.rejection-diagnostic-events li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 3px 0;
}

.rejection-diagnostics > small {
    color: #909399;
    line-height: 1.45;
}

.rejection-card-actions {
    padding-top: 12px;
    border-top: 1px solid #ebeef5;
}

.rejection-completeness {
    display: block;
    margin-top: 10px;
    line-height: 1.45;
}
</style>
