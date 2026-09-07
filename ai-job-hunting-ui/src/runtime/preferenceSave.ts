import type {AxiosInstance, AxiosRequestConfig} from 'axios'
import type {RequestFeedbackConfig} from '../requestFeedback'
import {responseErrorMessage} from './requestErrors.ts'

type PreferenceSource = {
    phone: string
    email: string
    preference: unknown
    aiSeatStatus?: number | boolean
}

export function preferencePayload(user: PreferenceSource) {
    return {
        phone: user.phone,
        email: user.email,
        preference: user.preference,
        aiSeatStatus: user.aiSeatStatus ? 1 : 0,
    }
}

export function savePreference(client: Pick<AxiosInstance, 'post'>, user: PreferenceSource) {
    const feedback: AxiosRequestConfig & RequestFeedbackConfig = {suppressGlobalErrorToast: true}
    return client.post('/api/user/save/preference', preferencePayload(user), feedback)
}

export function preferenceSaveFailure(error: unknown, localSaved = true) {
    const failure = error as {code?: string | number, message?: string, response?: {status?: number, data?: {message?: string}}}
    const code = failure?.code
    const localNote = localSaved ? '设置已保存在本地。' : '本地备份也未成功，请先导出设置。'
    if (!failure?.response && code === 'ERR_NETWORK') {
        return {title: '尚未同步到服务器', message: `${localNote}无法连接本地服务，请检查连接后重新保存。`, type: 'warning' as const}
    }
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        return {title: '保存请求超时', message: `${localNote}服务器是否保存尚未确认，请检查连接后重新同步。`, type: 'warning' as const}
    }
    const reason = responseErrorMessage(failure?.response?.data?.message,
        responseErrorMessage(failure?.message, '服务器未确认保存，请稍后重试'))
    return {title: '未同步到服务器', message: `${reason}。${localNote}`, type: 'error' as const}
}
