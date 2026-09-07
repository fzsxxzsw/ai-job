<template>
    <div class="company-exclusions-input">
        <div class="company-keyword-entry">
            <el-input v-model="draft" :placeholder="placeholder || '输入公司关键词后按 Enter'" :aria-label="inputLabel || '公司排除关键词'"
                      @keydown="onKeydown" @compositionstart="composing = true" @compositionend="composing = false"/>
            <el-button :disabled="!draft.trim() || composing" @click="addKeyword">添加</el-button>
        </div>
        <div v-if="modelValue.length" class="company-keyword-tags">
            <el-tag v-for="keyword in modelValue" :key="keyword" closable @close="removeKeyword(keyword)">{{ keyword }}</el-tag>
        </div>
        <span v-if="feedback" class="company-keyword-feedback" role="status">{{ feedback }}</span>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue'

const props = defineProps<{modelValue: string[], protectedKeywords?: string[], placeholder?: string, inputLabel?: string}>()
const emit = defineEmits<{(event: 'update:modelValue', values: string[]): void}>()
const draft = ref('')
const composing = ref(false)
const feedback = ref('')

function addKeyword() {
    if (composing.value) return
    const keyword = draft.value.trim()
    if (!keyword) return
    if (props.protectedKeywords?.includes(keyword)) {
        feedback.value = '该关键词已由内置规则排除，无需重复添加'
    } else if (props.modelValue.includes(keyword)) {
        feedback.value = '该关键词已在排除列表中'
    } else {
        emit('update:modelValue', [...props.modelValue, keyword])
        feedback.value = '已添加，请保存偏好设置'
    }
    draft.value = ''
}

function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || composing.value || event.keyCode === 229) return
    event.preventDefault()
    event.stopPropagation()
    addKeyword()
}

function removeKeyword(keyword: string) {
    emit('update:modelValue', props.modelValue.filter(value => value !== keyword))
    feedback.value = '已移除，请保存偏好设置'
}
</script>

<style>
.company-exclusions-input {width: 100%; min-width: 0;}
.company-exclusions-input .company-keyword-entry {display: flex; align-items: center; gap: 8px;}
.company-exclusions-input .company-keyword-entry .el-input {flex: 1; min-width: 0;}
.company-exclusions-input .company-keyword-entry .el-button {flex-shrink: 0;}
.company-exclusions-input .company-keyword-tags {display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;}
.company-exclusions-input .company-keyword-tags .el-tag {max-width: 100%; height: auto; min-height: 24px; white-space: normal; overflow-wrap: anywhere;}
.company-exclusions-input .company-keyword-feedback {display: block; margin-top: 4px; color: #606266; font-size: 12px; line-height: 1.6;}
</style>
