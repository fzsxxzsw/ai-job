import {computed, ref} from 'vue'
import {defineStore} from 'pinia'

export const PUSH_RUN_LOCK_NAME = 'ai-job-hunting-boss-push-run-v1'

export type PushRunStatus =
    | 'idle'
    | 'preparing'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'blocked'
    | 'completed'
    | 'failed'

export type PushRunResult = {
    status?: 'completed' | 'stopped' | 'blocked'
    reason?: string
}

export type PushRunExecution<T> = {
    acquired: boolean
    value?: T
}

export async function runWithOptionalWebLock<T>(
    lockManager: any,
    executor: () => Promise<T>,
): Promise<PushRunExecution<T>> {
    if (!lockManager?.request) return {acquired: true, value: await executor()}
    return await lockManager.request(
        PUSH_RUN_LOCK_NAME,
        {mode: 'exclusive', ifAvailable: true},
        async (lock: unknown) => lock
            ? {acquired: true, value: await executor()}
            : {acquired: false},
    )
}

function createRunId(): string {
    try {
        return crypto.randomUUID()
    } catch (_) {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
}

export const PushRunStore = defineStore('push-run', () => {
    const runId = ref('')
    const status = ref<PushRunStatus>('idle')
    const reason = ref('')
    const startedAt = ref<number>()
    const stopRequested = ref(false)
    const isActive = computed(() => ['preparing', 'running', 'stopping'].includes(status.value))
    let stopHandler: (() => void) | undefined

    async function run<T extends PushRunResult>(
        executor: () => Promise<T>,
        onStop: () => void,
    ): Promise<PushRunExecution<T>> {
        if (isActive.value) return {acquired: false}

        runId.value = createRunId()
        status.value = 'preparing'
        reason.value = ''
        startedAt.value = Date.now()
        stopRequested.value = false
        stopHandler = onStop

        try {
            const execution = await runWithOptionalWebLock(
                (globalThis.navigator as any)?.locks,
                async () => {
                    if (stopRequested.value) return {status: 'stopped', reason: '用户在预检阶段停止'} as T
                    return await executor()
                },
            )
            if (!execution.acquired) {
                status.value = 'blocked'
                reason.value = '另一个 BOSS 标签页正在运行投递任务'
                return execution
            }

            const result = execution.value
            reason.value = result?.reason || ''
            if (stopRequested.value || result?.status === 'stopped') status.value = 'stopped'
            else if (result?.status === 'blocked') status.value = 'blocked'
            else status.value = 'completed'
            return execution
        } catch (error: any) {
            status.value = 'failed'
            reason.value = String(error?.message || error || '未知错误')
            throw error
        } finally {
            stopHandler = undefined
        }
    }

    function stop(): boolean {
        if (!isActive.value) return false
        stopRequested.value = true
        status.value = 'stopping'
        stopHandler?.()
        return true
    }

    function markRunning(): boolean {
        if (status.value !== 'preparing' || stopRequested.value) return false
        status.value = 'running'
        return true
    }

    return {
        runId,
        status,
        reason,
        startedAt,
        stopRequested,
        isActive,
        run,
        stop,
        markRunning,
    }
})
