import {browser} from 'wxt/browser'
import {injectScript} from 'wxt/utils/inject-script'
import {defineContentScript} from 'wxt/utils/define-content-script'
import {installPageBridge} from '../src/extension/pageBridge'

// WXT recommends an isolated content script plus an injected unlisted script
// when page globals and extension APIs are both required:
// https://wxt.dev/guide/essentials/content-scripts.html#isolated-world-vs-main-world
export default defineContentScript({
    matches: [
        'https://www.zhipin.com/web/geek/*',
        'https://www.zhipin.com/overseas/*',
    ],
    allFrames: false,
    runAt: 'document_start',
    async main(ctx) {
        const removeBridge = installPageBridge(window, browser.runtime)
        ctx.onInvalidated(removeBridge)
        const stylesheet = document.createElement('link')
        stylesheet.rel = 'stylesheet'
        const getExtensionUrl = browser.runtime.getURL as unknown as (path: string) => string
        stylesheet.href = getExtensionUrl('assets/job-helper-main.css')
        stylesheet.dataset.aiJobHelperStyle = 'mv3'
        ;(document.head || document.documentElement).appendChild(stylesheet)
        ctx.onInvalidated(() => stylesheet.remove())
        await injectScript('/job-helper-main.js', {keepInDom: true})
    },
})
