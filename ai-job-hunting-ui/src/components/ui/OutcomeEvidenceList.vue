<template>
    <div v-if="evidence.length" class="outcome-evidence">
        <h4>证据</h4>
        <blockquote v-for="item in evidence" :key="item.evidenceId">
            <strong>{{ evidenceLabel(item) }}：</strong>{{ item.quote }} <small>（{{ item.evidenceId }}）</small>
        </blockquote>
    </div>
</template>
<script setup lang="ts">
import type {OutcomeEvidence} from '../../extension/outcomesProtocol'
defineProps<{evidence: OutcomeEvidence[]}>()
function evidenceLabel(item: OutcomeEvidence): string {
    if (item.source === 'JOB') return '岗位描述'
    if (item.source === 'RESUME') return '投递时简历'
    return item.role === 'HR' ? 'HR' : item.role === 'USER' ? '你' : '聊天记录'
}
</script>
<style scoped>
h4{margin:10px 0 4px}blockquote{margin:6px 0;padding:6px 10px;border-left:3px solid #92b9ab;background:white;white-space:pre-wrap;overflow-wrap:anywhere}
</style>
