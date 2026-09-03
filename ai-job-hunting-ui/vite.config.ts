import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import Markdown from 'vite-plugin-md';
import monkey, {cdn, util} from "vite-plugin-monkey";
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

let matchUrlList: string[] = [
    'https://www.zhipin.com/web/geek/*',
    'https://www.zhipin.com/overseas/*'
];

// https://vitejs.dev/config/
// https://github.com/lisonge/vite-plugin-monkey
export default defineConfig(({mode}) => {
    const isProduction = mode === 'production';
    const isLocalBuild = mode === 'personal' || mode === 'development';
    const runtimeVersion = isLocalBuild ? '0.0.62-local' : '0.0.27-beta';
    const buildId = process.env.JOB_HELPER_BUILD_ID
        || new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 17) + 'Z';

    const plugins = [
        {
            name: 'serve-local-userscript-loader',
            configureServer(server: any) {
                const loaderPath = fileURLToPath(new URL('./scripts/ai-job-hunting-loader.user.js', import.meta.url));
                server.middlewares.use((req: any, res: any, next: any) => {
                    if ((req.url || '').split('?')[0] !== '/ai-job-hunting-local.user.js') {
                        next();
                        return;
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store, max-age=0');
                    res.end(readFileSync(loaderPath, 'utf8'));
                });
            },
        },
        vue({
            include: [/\.vue$/, /\.md$/], // Support .vue and .md files
        }),
        Markdown(),
        AutoImport({
            resolvers: [ElementPlusResolver()],
        }),
        Components({
            resolvers: [ElementPlusResolver()],
        }),
        monkey({
            entry: 'src/main.ts',
            userscript: {
                name: isLocalBuild ? "AI工作猎手-本地个人版" : "AI工作猎手-让ai帮您找工作！",
                author: "maple.",
                  version: runtimeVersion,
                license: 'Apache License 2.0',
                icon: 'https://gitee.com/yangfeng20/ai-job/raw/master/file/icon.png',
                description: "找工作，用AI工作猎手！让AI帮您找工作！ai坐席：【DeepSeek+ChatGpt】赋能，ai助理作为您的求职者分身24小时 * 7在线找工作，并结合您的简历信息定制化回复。批量投递，自动发送简历，交换联系方式。hr拒绝挽留。高意向邮件通知，让您不错过每一份工作机会。BOSS直聘",
                namespace: 'https://github.com/yangfeng20',
                connect: ["docdownload.zhipin.com", "127.0.0.1", "localhost"],
                noframes: true,
                'run-at': 'document-start',
                ...(isLocalBuild ? {
                    updateURL: "http://127.0.0.1:5173/ai-job-hunting-local.user.js",
                    downloadURL: "http://127.0.0.1:5173/ai-job-hunting-local.user.js",
                } : {
                    updateURL: "https://gitee.com/yangfeng20/ai-job/raw/master/ai-job-hunting.user.js",
                    downloadURL: "https://gitee.com/yangfeng20/ai-job/raw/master/ai-job-hunting.user.js",
                }),
                match: matchUrlList,
            },
            build: {
                // The local runtime is loaded from 127.0.0.1 and must remain
                // usable when public CDNs are slow or unavailable. Production
                // keeps the smaller external-dependency build for now.
                ...(isLocalBuild ? {} : {
                    externalGlobals: {
                        vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js')
                            .concat('https://unpkg.com/vue-demi@latest/lib/index.iife.js')
                            .concat(util.dataUrl(";window.Vue=Vue;")),
                        "element-plus": cdn.jsdelivr("ElementPlus", "dist/index.full.min.js"),
                        protobufjs: cdn.jsdelivr("protobuf", "dist/protobuf.min.js"),
                        pinia: cdn.jsdelivr("Pinia", "dist/pinia.iife.prod.js"),
                        "event-source-polyfill": cdn.jsdelivr("EventSourcePolyfill", "src/eventsource.min.js"),
                    },
                    externalResource: {
                        "element-plus/dist/index.css": cdn.jsdelivr(),
                        "element-plus/theme-chalk/dark/css-vars.css": cdn.jsdelivr(),
                    },
                }),
            },
        })
    ];

    return {
        plugins,
        build: isLocalBuild ? {
            // The stable loader evaluates the downloaded runtime directly. Keep
            // every lazy module in the same IIFE so the local bundle never needs
            // SystemJS (or a public CDN) merely to finish bootstrapping.
            rollupOptions: {
                output: {
                    inlineDynamicImports: true,
                },
            },
        } : undefined,
        define: {
            __AI_JOB_HELPER_RUNTIME_VERSION__: JSON.stringify(runtimeVersion),
            __AI_JOB_HELPER_BUILD_ID__: JSON.stringify(buildId),
        },
        resolve: {
            extensions: ['.js', '.ts', '.vue', '.json', '.css'],
            alias: {
                'vue': 'vue/dist/vue.esm-bundler.js'
            }
        },
    };
});
