<template>
  <section class="model-routing" v-loading="loading">
    <div class="routing-heading">
      <div><h3>多模型与免费额度</h3><p>同一 API Key，按任务分配模型，额度耗尽后自动切换。</p></div>
      <el-button @click="load" :disabled="busy">重新加载</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <template v-if="data">
      <el-alert :title="data.balanceNote" type="info" :closable="false" show-icon />
      <p class="routing-hint">使用当前生效的 API 配置：{{ data.provider }} · 默认模型 {{ data.configuredModel }}。此处不保存密钥。</p>
      <el-alert v-if="!data.providerSupported" title="当前连接不是百炼北京地域，暂不能启用免费额度模型池。" type="warning" :closable="false" />
      <div class="routing-controls">
        <el-switch v-model="draft.enabled" active-text="自动选模" :disabled="!data.providerSupported || busy" />
        <el-select v-model="draft.strategy" style="width: 170px" aria-label="选模策略">
          <el-option label="任务适配优先" value="balanced" /><el-option label="临近到期优先" value="expiry_first" />
        </el-select>
        <label>最多尝试 <el-input-number v-model="draft.maxAttempts" :min="1" :max="5" size="small" /></label>
        <label>总等待（秒） <el-input-number v-model="draft.totalTimeoutSeconds" :min="5" :max="120" size="small" /></label>
        <el-button type="primary" @click="save" :disabled="busy || !data.providerSupported">保存配置</el-button>
      </div>
      <div class="routing-toolbar">
        <el-input v-model="search" placeholder="搜索模型名称" clearable style="width: 230px" />
        <el-select v-model="statusFilter" style="width: 140px" aria-label="状态筛选">
          <el-option label="全部状态" value="all" /><el-option label="可自动分配" value="ready" />
          <el-option label="需要处理" value="attention" />
        </el-select>
        <el-button @click="addCatalog" :disabled="busy">加载预置目录</el-button>
        <el-button @click="importVisible = true" :disabled="busy">批量导入额度</el-button>
        <el-button @click="testEnabled" :disabled="busy || !draft.models.some(m => m.enabled)">测试已启用模型</el-button>
        <span>{{ draft.models.length }} 个模型 · {{ readyCount }} 个可分配</span>
      </div>
      <p v-if="testProgress" role="status">{{ testProgress }}</p>
      <el-table :data="visibleModels" row-key="id" max-height="460" stripe size="small">
        <el-table-column label="启用" width="62" fixed>
          <template #default="{row}"><el-switch v-model="row.enabled" :disabled="!info(row.id).supportedTasks.length || busy" :aria-label="'启用 ' + row.id" /></template>
        </el-table-column>
        <el-table-column label="模型 / 能力" min-width="260">
          <template #default="{row}"><strong>{{ row.id }}</strong><div class="routing-hint">{{ info(row.id).category }}</div>
            <div class="routing-hint" v-if="info(row.id).note">{{ info(row.id).note }}</div></template>
        </el-table-column>
        <el-table-column label="参与任务" min-width="195">
          <template #default="{row}"><el-select v-model="row.tasks" multiple collapse-tags style="width: 180px" :disabled="busy || !info(row.id).supportedTasks.length">
            <el-option v-for="task in info(row.id).supportedTasks" :key="task" :label="data.tasks[task]" :value="task" />
          </el-select></template>
        </el-table-column>
        <el-table-column label="优先级" width="118"><template #default="{row}"><el-input-number v-model="row.priority" :min="1" :max="100" size="small" style="width: 100px" /></template></el-table-column>
        <el-table-column label="剩余额度 / 到期日" min-width="165"><template #default="{row}">
          <div>{{ number(stats(row.id)?.remainingTokensEstimate) }} <small>（估算）</small></div>
          <div class="routing-hint">{{ stats(row.id)?.snapshot?.expiresOn || '尚未导入' }}</div>
          <div class="routing-hint">已记账 {{ number(stats(row.id)?.reportedTokens ?? 0) }} Token</div>
        </template></el-table-column>
        <el-table-column label="状态" min-width="155"><template #default="{row}">
          <el-tag :type="stats(row.id)?.status === 'ready' ? 'success' : 'info'">{{ statusLabel(stats(row.id)?.status) }}</el-tag>
          <div class="routing-hint" v-if="stats(row.id)?.lastTest">测试：{{ statusLabel(stats(row.id)?.lastTest?.status) }}</div>
        </template></el-table-column>
        <el-table-column label="用完即停" width="105"><template #default="{row}"><el-checkbox v-model="row.freeOnlyConfirmed" :disabled="busy">已确认</el-checkbox></template></el-table-column>
        <el-table-column label="操作" width="150" fixed="right"><template #default="{row}">
          <el-button link type="primary" @click="openQuota(row.id)" :disabled="busy">校准额度</el-button>
          <el-button link type="primary" @click="testOne(row.id)" :disabled="busy || !row.enabled">测试</el-button>
        </template></el-table-column>
      </el-table>
      <p class="routing-hint">优先级越大越优先。同等级模型轮换使用。请在百炼控制台开启“免费额度用完即停”后勾选确认；测试会产生少量 Token 用量。修改配置后先保存，再测试。</p>
      <el-collapse><el-collapse-item title="最近的模型调用" name="events">
        <el-table :data="data.events" size="small" max-height="280">
          <el-table-column label="时间" width="160"><template #default="{row}">{{ new Date(row.at).toLocaleString() }}</template></el-table-column>
          <el-table-column prop="model" label="实际模型" min-width="230" />
          <el-table-column label="任务" width="100"><template #default="{row}">{{ data.tasks[row.task] || '连接测试' }}</template></el-table-column>
          <el-table-column label="结果" min-width="160"><template #default="{row}">{{ statusLabel(row.status) }}</template></el-table-column>
          <el-table-column label="Token" width="100"><template #default="{row}">{{ row.estimated ? '估算记账' : number(row.tokens) }}</template></el-table-column>
          <el-table-column label="耗时" width="90"><template #default="{row}">{{ (row.durationMs / 1000).toFixed(1) }} 秒</template></el-table-column>
        </el-table>
      </el-collapse-item></el-collapse>
    </template>
    <el-dialog v-model="quotaVisible" title="校准模型免费额度" width="520px" append-to-body>
      <p>{{ quota.id }}</p>
      <el-form label-width="110px">
        <el-form-item label="控制台剩余量"><el-input-number v-model="quota.remainingTokens" :min="0" :max="10000000000" /></el-form-item>
        <el-form-item label="额度到期日"><el-date-picker v-model="quota.expiresOn" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="费用保护"><el-checkbox v-model="quota.freeOnlyConfirmed">已在百炼开启免费额度用完即停</el-checkbox></el-form-item>
      </el-form>
      <p class="routing-hint">填写刚从控制台查看的余额。旧截图的原始时间请用批量导入保留，避免重复增加额度。</p>
      <template #footer><el-button @click="quotaVisible = false">取消</el-button><el-button type="primary" @click="importOne" :loading="busy">保存额度</el-button></template>
    </el-dialog>
    <el-dialog v-model="importVisible" title="批量导入额度快照" width="680px" append-to-body>
      <p>粘贴 JSON。每个模型需要名称、剩余 Token、到期日、查看时间和用完即停确认。相同时间的快照重复导入不会补回已用额度。</p>
      <el-input v-model="importText" type="textarea" :rows="12" :placeholder="importExample" />
      <template #footer><el-button @click="importVisible = false">取消</el-button><el-button type="primary" @click="importMany" :loading="busy">导入</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import axios from '../../axios'
import {ElMessage} from '../../utils/tools'
import {ServerStore} from '../../stores/server'

type ModelRow = {id: string; enabled: boolean; tasks: string[]; priority: number; thinking: string; freeOnlyConfirmed: boolean}
type Info = {id: string; category: string; supportedTasks: string[]; note: string}
type Snapshot = {expiresOn: string; remainingTokens: number}
type ModelStats = Info & {status: string; remainingTokensEstimate: number | null; snapshot?: Snapshot; reportedTokens: number; lastTest?: {status: string}}
type RoutingConfig = {enabled: boolean; revision: number; strategy: string; maxAttempts: number; totalTimeoutSeconds: number; models: ModelRow[]}
type RoutingData = {config: RoutingConfig; models: ModelStats[]; catalog: Info[]; events: any[]; tasks: Record<string, string>; provider: string; providerSupported: boolean; configuredModel: string; balanceNote: string}
const data = ref<RoutingData | null>(null)
const draft = ref<RoutingConfig>({enabled: false, revision: 0, strategy: 'balanced', maxAttempts: 3, totalTimeoutSeconds: 40, models: []})
const loading = ref(false), busy = ref(false), error = ref(''), search = ref(''), statusFilter = ref('all')
const testProgress = ref(''), importVisible = ref(false), importText = ref(''), quotaVisible = ref(false)
const quota = ref({id: '', remainingTokens: 0, expiresOn: '', freeOnlyConfirmed: false})
const importExample = '{"snapshots":[{"id":"qwen-turbo","remainingTokens":1000000,"expiresOn":"2026-10-01","observedAt":"2026-09-07T13:36:00+08:00","freeOnlyConfirmed":true}]}'
const labels: Record<string, string> = {ready: '可自动分配', success: '成功', disabled: '未启用', unsupported: '专用接口 / 任务', quota_unknown: '未导入额度', free_stop_unconfirmed: '未确认用完即停', expired: '额度已到期', free_quota_exhausted: '免费额度已耗尽', insufficient_quota: '预估额度不足', cooldown: '暂时冷却', model_unavailable: '模型不可用', invalid_request: '请求不兼容', authentication: '密钥无效', permission: '权限不足', rate_limit: '模型限流', timeout: '请求超时', provider_unavailable: '服务暂不可用', invalid_response: '响应无效'}
const statusLabel = (status?: string) => labels[status || 'quota_unknown'] || status
const number = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString()
const stats = (id: string) => data.value?.models.find(m => m.id === id)
const info = (id: string): Info => stats(id) || data.value?.catalog.find(m => m.id === id) || {id, category: '待确认', supportedTasks: [], note: '先导入额度以确认模型能力'}
const readyCount = computed(() => data.value?.models.filter(m => m.status === 'ready').length || 0)
const visibleModels = computed(() => draft.value.models.filter(m => m.id.toLowerCase().includes(search.value.toLowerCase()) && (statusFilter.value === 'all' || (statusFilter.value === 'ready' ? stats(m.id)?.status === 'ready' : stats(m.id)?.status !== 'ready'))))
const serverStore = ServerStore()
let mounted = true, operationRevision = 0, dataScope = ''
let activeController: AbortController | null = null
const currentScope = () => JSON.stringify([serverStore.baseUrl, serverStore.generation, localStorage.getItem('Authorization')])
function clearScope() {
  operationRevision++; activeController?.abort(); activeController = null
  data.value = null; dataScope = ''; busy.value = false; loading.value = false
  testProgress.value = ''; importVisible.value = false; quotaVisible.value = false
}
watch(() => [serverStore.baseUrl, serverStore.generation], () => {
  clearScope(); error.value = '连接已切换，请重新加载模型配置'
}, {flush: 'sync'})
onBeforeUnmount(() => {mounted = false; operationRevision++; activeController?.abort()})
function beginOperation(requireLoaded = false) {
  if (!mounted) return null
  const scope = currentScope()
  if (requireLoaded && dataScope !== scope) {
    clearScope(); error.value = '连接或登录状态已变化，请重新加载模型配置'
    return null
  }
  activeController?.abort()
  const controller = activeController = new AbortController()
  const revision = ++operationRevision
  const current = () => mounted && revision === operationRevision && scope === currentScope()
  return {scope, current, config: {signal: controller.signal, jobHelperScopeGuard: current}, finish: () => {
    if (!mounted || revision !== operationRevision) return false
    if (!current()) {
      clearScope(); error.value = '连接或登录状态已变化，操作已停止，请重新加载'
      return false
    }
    return true
  }}
}
function apply(value: RoutingData, scope = currentScope()) {data.value = value; draft.value = JSON.parse(JSON.stringify(value.config)); dataScope = scope}
async function load() {
  const operation = beginOperation(); if (!operation) return
  loading.value = true; error.value = ''
  try {const response = await axios.get('/api/user/ai/routing', operation.config); if (operation.current()) apply(response.data.data, operation.scope)}
  catch (e: any) {if (operation.current()) error.value = e.message || '无法加载模型配置'}
  finally {if (operation.finish()) loading.value = false}
}
async function save() {
  const operation = beginOperation(true); if (!operation) return
  busy.value = true; error.value = ''
  try {const response = await axios.post('/api/user/ai/routing', draft.value, operation.config); if (operation.current()) {apply(response.data.data, operation.scope); ElMessage({type: 'success', message: '模型配置已保存'})}}
  catch (e: any) {if (operation.current()) error.value = e.message}
  finally {if (operation.finish()) busy.value = false}
}
function addCatalog() {
  const ids = new Set(draft.value.models.map(m => m.id))
  for (const model of data.value?.catalog || []) if (!ids.has(model.id)) draft.value.models.push({id: model.id, enabled: false, tasks: model.supportedTasks, priority: 50, thinking: 'auto', freeOnlyConfirmed: false})
}
function openQuota(id: string) {
  quota.value = {id, remainingTokens: stats(id)?.remainingTokensEstimate || 0, expiresOn: stats(id)?.snapshot?.expiresOn || '', freeOnlyConfirmed: draft.value.models.find(m => m.id === id)?.freeOnlyConfirmed || false}
  quotaVisible.value = true
}
async function sendImport(payload: unknown) {
  const operation = beginOperation(true); if (!operation) return
  busy.value = true; error.value = ''
  try {const response = await axios.post('/api/user/ai/routing/quotas', payload, operation.config); if (operation.current()) {apply(response.data.data, operation.scope); importVisible.value = false; quotaVisible.value = false; ElMessage({type: 'success', message: '额度快照已导入'})}}
  catch (e: any) {if (operation.current()) error.value = e.message}
  finally {if (operation.finish()) busy.value = false}
}
async function importOne() {await sendImport({snapshots: [{...quota.value, observedAt: new Date().toISOString()}]})}
async function importMany() {
  try {const parsed = JSON.parse(importText.value); await sendImport(Array.isArray(parsed) ? {snapshots: parsed} : parsed)}
  catch {error.value = '请输入有效的 JSON 额度快照'}
}
async function testOne(id: string) {
  const operation = beginOperation(true); if (!operation) return
  busy.value = true; error.value = ''; testProgress.value = `正在测试 ${id}`
  try {await axios.post('/api/user/ai/routing/test', {id}, {...operation.config, timeout: 130000}); if (operation.current()) testProgress.value = `${id} 测试通过`}
  catch (e: any) {if (operation.current()) {error.value = e.message; testProgress.value = `${id} 测试失败，原因已记录`}}
  finally {if (operation.finish()) {busy.value = false; await load()}}
}
async function testEnabled() {
  const operation = beginOperation(true); if (!operation) return
  busy.value = true; error.value = ''
  const ids = data.value?.config.models.filter(m => m.enabled).map(m => m.id) || []
  let passed = 0
  try {
    for (let i = 0; i < ids.length; i++) {
      if (!operation.current()) return
      testProgress.value = `正在测试 ${i + 1}/${ids.length}：${ids[i]}`
      try {await axios.post('/api/user/ai/routing/test', {id: ids[i]}, {...operation.config, timeout: 130000}); if (!operation.current()) return; passed++}
      catch (e: any) {if (!operation.current()) return; if (e.message?.includes('密钥') || e.message?.includes('权限') || e.message?.includes('登录')) {error.value = e.message; break}}
    }
    if (operation.current()) testProgress.value = `测试结束：${passed}/${ids.length} 通过，详情见模型状态和调用记录`
  } finally {if (operation.finish()) {busy.value = false; await load()}}
}
onMounted(load)
</script>

<style scoped>
.model-routing {margin-bottom: 22px; padding: 18px; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--el-bg-color); text-align: left;}
.routing-heading {display: flex; justify-content: space-between; gap: 12px; align-items: center;}
.routing-heading h3 {margin: 0 0 6px; font-size: 17px;}
.routing-heading p, .routing-hint {font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary);}
.routing-controls, .routing-toolbar {display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 15px 0;}
.routing-controls label {font-size: 12px;}
.routing-controls .el-input-number {width: 100px;}
.routing-toolbar > span {font-size: 12px; color: var(--el-text-color-secondary);}
.model-routing :deep(.el-alert) {margin: 10px 0;}
</style>
