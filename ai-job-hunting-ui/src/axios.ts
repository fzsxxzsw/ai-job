import axios from 'axios'
import {IS_PERSONAL_MODE} from './deploymentMode'
import {ElMessage} from './utils/tools'
import {BizCodeEnum} from './types'
import {LoginStore, ProductStore} from './stores'
import {DEFAULT_SERVER_URL, ServerStore} from './stores/server'
import {shouldShowGlobalErrorToast} from './requestFeedback'
import {ApiRequestError, responseErrorMessage} from './runtime/requestErrors'
import {createToastGate} from './ui/feedback'
import {modelRequestTimeout} from './runtime/modelRequestTimeout'

const request = axios.create({timeout: 10000, headers: {'Content-Type': 'application/json; charset=utf-8'}})
const mayShowError = createToastGate()

request.interceptors.request.use(req => {
    const scopeGuard = (req as any).jobHelperScopeGuard
    if (typeof scopeGuard === 'function' && !scopeGuard()) {
        throw new axios.CanceledError('连接或登录状态已变化，已取消旧操作')
    }
    req.timeout = modelRequestTimeout(req.url, req.timeout)
    try {
        const store = ServerStore()
        req.baseURL = store.baseUrl
        ;(req as any).jobHelperServerGeneration = store.generation
    } catch (_) { req.baseURL = DEFAULT_SERVER_URL }
    const authorization = localStorage.getItem('Authorization')
    if (authorization) req.headers['Authorization'] = authorization
    return req
})

function stale(config: any): boolean {
    if (config?.jobHelperServerGeneration === undefined) return false
    const server = ServerStore()
    return config.jobHelperServerGeneration !== server.generation || config.baseURL !== server.baseUrl
}
function notify(config: any, error: ApiRequestError) {
    if (shouldShowGlobalErrorToast(config) && mayShowError(error.message)) {
        ElMessage({type: 'error', message: error.message, grouping: true})
    }
}
function expiredLogin(config: any, response?: any): never {
    const sentToken = config?.headers?.get?.('Authorization') ?? config?.headers?.Authorization
    const currentToken = localStorage.getItem('Authorization')
    if (currentToken && sentToken && currentToken !== sentToken) {
        throw new ApiRequestError('已忽略旧登录凭证的响应', 'STALE_AUTH_REQUEST', response)
    }
    LoginStore().invalidate()
    localStorage.removeItem('Authorization')
    const error = new ApiRequestError('登录已过期，请点击“连接测试”重新同步；不会自动刷新页面', 401, response)
    notify(config, error)
    throw error
}

request.interceptors.response.use(resp => {
    if (stale(resp.config)) throw new ApiRequestError('已忽略旧服务器的响应', 'STALE_SERVER_REQUEST')
    // Connection state is owned by the health monitor, not by AI requests or auth failures.
    const result = resp.data || {}
    if (result?.code === 200 || (result?.code >= 2000 && result?.code < 5000)) return resp
    if (result?.code === 401) return expiredLogin(resp.config, resp)
    if (!IS_PERSONAL_MODE && result.code === BizCodeEnum.PRODUCT_NOT_AUTHORIZED) ProductStore().setShowProduct(true)
    const error = new ApiRequestError(responseErrorMessage(result?.message), result?.code || 'INVALID_RESPONSE', resp)
    notify(resp.config, error)
    throw error
}, error => {
    if (stale(error?.config)) throw new ApiRequestError('已忽略旧服务器的响应', 'STALE_SERVER_REQUEST')
    if (axios.isCancel(error)) return Promise.reject(error)
    if (error?.response?.status === 401 || error?.response?.data?.code === 401) return expiredLogin(error.config, error.response)
    let message: string
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
        message = '本次请求超时，请稍后重试；服务器状态以连接检查为准'
    } else if (error?.code === 'ERR_NETWORK') {
        message = '无法访问本地服务，请确认 Docker 已启动，或点击“连接测试”'
    } else {
        message = responseErrorMessage(error?.response?.data?.message,
            error?.response?.status === 404 ? '接口不存在，请检查前后端版本' : '请求失败，请稍后重试')
    }
    const normalized = new ApiRequestError(message, error?.response?.data?.code || error?.code || 'REQUEST_FAILED', error?.response)
    notify(error?.config, normalized)
    return Promise.reject(normalized)
})
export default request
