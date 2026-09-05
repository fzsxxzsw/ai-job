/// <reference types="vite/client" />

declare const __AI_JOB_HELPER_RUNTIME_VERSION__: string
declare const __AI_JOB_HELPER_BUILD_ID__: string

// 用于ts使用vue不能识别问题
declare module '*.vue' {
    import type {DefineComponent} from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

declare module 'event-source-polyfill';


// 支持md识别
declare module '*.md' {
    import {DefineComponent} from 'vue';
    const Component: DefineComponent<{}, {}, any>;
    export default Component;
}
