import {defineUnlistedScript} from 'wxt/utils/define-unlisted-script'

export default defineUnlistedScript(() => {
    // Keep all existing Vue, route, fetch/XHR and WebSocket hooks in the page's
    // main world. The import runs only after the isolated bridge is installed.
    void import('../src/main')
})
