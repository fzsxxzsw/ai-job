import {ref, computed, onScopeDispose} from 'vue'
import {defineStore} from 'pinia'
import {TampermonkeyApi} from '../platform/utils'
import {createHealthMonitor, DEFAULT_SERVER_URL, normalizeServerUrl, type HealthState} from '../runtime/serverHealth'
export {DEFAULT_SERVER_URL} from '../runtime/serverHealth'

const SERVER_URL_KEY = 'custom_server_url'

export const ServerStore = defineStore('server', () => {
    let initialUrl = DEFAULT_SERVER_URL
    try { initialUrl = normalizeServerUrl(TampermonkeyApi.GmGetValue(SERVER_URL_KEY, DEFAULT_SERVER_URL)) } catch (_) {}
    const baseUrl = ref(initialUrl)
    const generation = ref(0)
    const status = ref<HealthState['status']>('checking')
    const isChecking = ref(false)
    const lastError = ref('')
    const lastCheckedAt = ref(0)
    const isOnline = computed(() => status.value === 'online')
    const monitor = createHealthMonitor({
        getUrl: () => baseUrl.value,
        canPoll: () => document.visibilityState !== 'hidden',
        onChange: state => {
            status.value = state.status; isChecking.value = state.isChecking
            lastError.value = state.lastError; lastCheckedAt.value = state.lastCheckedAt
        },
    })
    function setBaseUrl(url: string) {
        const normalized = normalizeServerUrl(url)
        if (normalized !== baseUrl.value) {
            baseUrl.value = normalized
            generation.value++
            monitor.invalidate()
        }
        TampermonkeyApi.GmSetValue(SERVER_URL_KEY, normalized)
    }
    function resetBaseUrl() { setBaseUrl(DEFAULT_SERVER_URL) }
    function getMirrorKey(type: string) {
        return `mirror_${type}_${baseUrl.value.replace(/[^a-zA-Z0-9]/g, '_')}`
    }
    function getGlobalMirrorKey(type: string) { return `mirror_${type}_global_latest` }
    function checkConnection(foreground = true) { return monitor.check(foreground) }
    let monitoring = false
    const onVisible = () => { if (document.visibilityState !== 'hidden') void checkConnection(false) }
    function startMonitoring() {
        if (monitoring) return
        monitoring = true
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('online', onVisible)
        monitor.start()
    }
    function stopMonitoring() {
        monitoring = false
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('online', onVisible)
        monitor.stop()
    }
    onScopeDispose(stopMonitoring)
    return {baseUrl, generation, status, lastError, lastCheckedAt, isChecking, isOnline,
        setBaseUrl, resetBaseUrl, getMirrorKey, getGlobalMirrorKey,
        checkConnection, startMonitoring, stopMonitoring}
})
