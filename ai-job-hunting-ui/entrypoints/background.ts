import {browser} from 'wxt/browser'
import {defineBackground} from 'wxt/utils/define-background'
import {createBackgroundService} from '../src/extension/backgroundService'

const notificationIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#00b38a"/><path d="M31 93V35h35c20 0 31 9 31 25 0 10-5 18-14 22l17 11H77L64 84H51v9H31zm20-28h15c7 0 11-2 11-7s-4-7-11-7H51v14z" fill="white"/></svg>')}`

export default defineBackground(() => {
    const service = createBackgroundService({
        fetch: globalThis.fetch.bind(globalThis),
        createNotification: payload => browser.notifications.create({
            type: 'basic',
            iconUrl: notificationIcon,
            title: payload.title,
            message: payload.text,
            silent: payload.silent,
        }),
        clearNotification: notificationId => browser.notifications.clear(notificationId),
        setTimer: (callback, delay) => setTimeout(callback, delay),
        clearTimer: handle => clearTimeout(handle),
    })
    browser.runtime.onMessage.addListener((rawMessage, sender) => service.handleMessage(rawMessage, sender))
    browser.notifications.onClosed.addListener(notificationId => service.handleNotificationClosed(notificationId))
    browser.notifications.onClicked.addListener(notificationId => service.handleNotificationClicked(notificationId))
})
