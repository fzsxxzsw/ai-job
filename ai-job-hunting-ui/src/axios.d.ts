import 'axios'

declare module 'axios' {
    interface AxiosRequestConfig<D = any> {
        suppressGlobalErrorToast?: boolean
    }

    interface InternalAxiosRequestConfig<D = any> {
        suppressGlobalErrorToast?: boolean
    }
}
