<template>
    <AutomationTasks/>
    <section class="outcome-panel" aria-label="求职进展自动分析">
        <div class="outcome-heading">
            <strong>求职进展自动分析</strong>
            <el-tag size="small" :type="state.error ? 'warning' : 'success'" effect="plain">
                {{ state.error ? '后台稍后重试' : '后台自动运行' }}
            </el-tag>
        </div>
        <p v-if="state.error" class="outcome-warning" role="status">
            分析服务暂时不可用，已保存的观察会继续重试。
        </p>
        <p v-else-if="currentReport" class="outcome-summary">
            当前会话：{{ currentReport.summary }}
        </p>
        <p v-else class="outcome-meta">
            后台会自动识别回复、面试、Offer 和拒绝，并汇总到“求职复盘”。
        </p>
    </section>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {getSelectedConversationIdentity} from '../../platform/deliveryAudit'
import {subscribeOutcomeReports, watchCurrentOutcomeConversation} from '../../platform/boss/outcomeRuntime'
import type {OutcomeReport, OutcomeStatus} from '../../extension/outcomesProtocol'
import AutomationTasks from './AutomationTasks.vue'

const state = ref<OutcomeStatus & {unbound: number; discarded: number; captureDiagnostic?: string}>({
    scope: '',
    pending: 0,
    blocked: 0,
    expired: 0,
    error: '',
    items: [],
    updatedAt: 0,
    unbound: 0,
    discarded: 0,
})
const currentReport = computed<OutcomeReport | null>(() => {
    const conversationKey = getSelectedConversationIdentity(document)?.conversationKey
    if (!conversationKey) return null
    return state.value.items.find(item => item.conversationKey === conversationKey)?.report || null
})
let disposeReports: (() => void) | undefined
let disposeConversation: (() => void) | undefined

onMounted(() => {
    disposeReports = subscribeOutcomeReports(value => { state.value = value })
    disposeConversation = watchCurrentOutcomeConversation()
})
onUnmounted(() => {
    disposeReports?.()
    disposeConversation?.()
})
</script>

<style scoped>
.outcome-panel{margin:12px 0;padding:10px 12px;border:1px solid #dce6e2;border-radius:8px;background:#f8fbfa;font-size:13px;color:#243b33}
.outcome-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.outcome-summary,.outcome-meta,.outcome-warning{margin:6px 0 0;line-height:1.5}
.outcome-summary{font-weight:500}.outcome-warning{color:#925000}.outcome-meta{color:#687d73;font-size:12px}
</style>
