import {defineExtensionMessaging} from '@webext-core/messaging'

import type {BackgroundRequest, BackgroundResponse} from './bridgeProtocol.ts'

/**
 * Typed content-script <-> service-worker RPC. The page-world boundary remains
 * separately validated by bridgeProtocol before a request reaches this layer.
 */
interface JobHelperExtensionProtocol {
    'job-helper.request'(request: BackgroundRequest): Promise<BackgroundResponse>
}

export const {
    sendMessage: sendExtensionMessage,
    onMessage: onExtensionMessage,
} = defineExtensionMessaging<JobHelperExtensionProtocol>({
    throwOnUnknownMessageFormat: false,
})
