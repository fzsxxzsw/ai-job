<template>
    <div class="company-exclusions-input">
        <div class="company-keyword-entry">
            <div class="company-keyword-control" role="group" :aria-label="inputLabel || '公司排除关键词'" @click.self="focusDraft">
                <el-tag v-for="keyword in modelValue" :key="keyword" closable @close="removeKeyword(keyword)">{{ keyword }}</el-tag>
                <el-input ref="draftInput" v-model="draft" class="company-keyword-draft"
                          :placeholder="placeholder || '输入公司关键词，回车添加'" :aria-label="inputLabel || '公司排除关键词'"
                          @keydown="onKeydown" @compositionstart="composing = true" @compositionend="composing = false"/>
            </div>
            <el-button :disabled="!draft.trim() || composing" @click="addKeyword">添加</el-button>
        </div>
        <span v-if="feedback" class="company-keyword-feedback" role="status">{{ feedback }}</span>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue'
import type {InputInstance} from 'element-plus'

const props = defineProps<{modelValue: string[], protectedKeywords?: string[], placeholder?: string, inputLabel?: string}>()
const emit = defineEmits<{(event: 'update:modelValue', values: string[]): void}>()
const draft = ref('')
const composing = ref(false)
const feedback = ref('')
const draftInput = ref<InputInstance>()

function focusDraft() {
    draftInput.value?.focus()
}

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
.company-exclusions-input .company-keyword-entry {display: flex; align-items: flex-start; gap: 8px;}
.company-exclusions-input .company-keyword-control {
    display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 6px 8px;
    min-width: 0; min-height: 40px; padding: 7px 11px; box-sizing: border-box;
    border: 1px solid var(--el-border-color, #dcdfe6); border-radius: var(--el-border-radius-base, 4px);
    background: var(--el-fill-color-blank, #fff);
}
.company-exclusions-input .company-keyword-control:hover {border-color: var(--el-border-color-hover, #c0c4cc);}
.company-exclusions-input .company-keyword-control:focus-within {border-color: var(--el-color-primary, #409eff);}
.company-exclusions-input .company-keyword-entry .company-keyword-control .company-keyword-draft.el-input {
    flex: 1 1 180px; width: auto !important; min-width: 0; height: 24px;
    --el-input-height: 24px; --el-input-inner-height: 24px;
}
.company-exclusions-input .company-keyword-control .company-keyword-draft > .el-input__wrapper {
    padding: 0 !important; background: transparent !important; box-shadow: none !important;
}
.company-exclusions-input .company-keyword-entry .el-button {flex-shrink: 0;}
.company-exclusions-input .company-keyword-control .el-tag {max-width: 100%; height: auto; min-height: 24px; white-space: normal; overflow-wrap: anywhere;}
.company-exclusions-input .company-keyword-control .el-tag__content {min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.4;}
.company-exclusions-input .company-keyword-control .el-tag__close {flex-shrink: 0;}
.company-exclusions-input .company-keyword-feedback {display: block; margin-top: 4px; color: #606266; font-size: 12px; line-height: 1.6;}
</style>
