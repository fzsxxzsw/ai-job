import {
    BACKGROUND_CHANNEL,
    BRIDGE_PROTOCOL_VERSION,
    ISOLATED_WORLD_SOURCE,
    MAIN_WORLD_SOURCE,
    parsePageBridgeRequest,
    toBackgroundRequest,
    toPageBridgeResponse,
} from './bridgeProtocol.ts'
import type {BackgroundResponse} from './bridgeProtocol.ts'

type PageWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'postMessage' | 'location'>
type RuntimeMessenger = {sendMessage(message: unknown): Promise<unknown>}

export function installPageBridge(pageWindow: PageWindow, runtime: RuntimeMessenger): () => void {
    const onMessage = (event: MessageEvent) => {
        if (event.source !== pageWindow || event.origin !== pageWindow.location.origin) return
        const request = parsePageBridgeRequest(event.data)
        if (!request) return
        void runtime.sendMessage(toBackgroundRequest(request)).then(rawResponse => {
            const response = rawResponse as BackgroundResponse
            if (!response || response.channel !== BACKGROUND_CHANNEL || response.protocol !== BRIDGE_PROTOCOL_VERSION
                || response.requestId !== request.requestId) throw new Error('扩展后台返回了无效响应')
            pageWindow.postMessage(toPageBridgeResponse(response), pageWindow.location.origin)
        }).catch(error => {
            pageWindow.postMessage({
                protocol: BRIDGE_PROTOCOL_VERSION,
                source: ISOLATED_WORLD_SOURCE,
                target: MAIN_WORLD_SOURCE,
                requestId: request.requestId,
                ok: false,
                operation: 'error',
                error: {kind: 'network', message: String(error?.message || error || '扩展后台不可用').slice(0, 500)},
            }, pageWindow.location.origin)
        })
    }
    pageWindow.addEventListener('message', onMessage as EventListener)
    return () => pageWindow.removeEventListener('message', onMessage as EventListener)
}
