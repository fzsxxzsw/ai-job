export interface RequestFeedbackConfig {
    suppressGlobalErrorToast?: boolean
}

export function shouldShowGlobalErrorToast(config?: RequestFeedbackConfig | null): boolean {
    return config?.suppressGlobalErrorToast !== true
}
