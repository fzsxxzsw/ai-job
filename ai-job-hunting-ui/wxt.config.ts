import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parse} from 'acorn'
import vue from '@vitejs/plugin-vue'
import Markdown from 'vite-plugin-md'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import type {Plugin} from 'vite'
import {defineConfig} from 'wxt'

const matches = [
    'https://www.zhipin.com/web/geek/*',
    'https://www.zhipin.com/overseas/*',
]
const accessibleResourceMatches = ['https://www.zhipin.com/*']
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'))
const extensionVersion = String(packageJson.version)
const buildId = String(process.env.JOB_HELPER_BUILD_ID || 'dev-local').replace(/[^0-9A-Za-z._-]/g, '-').slice(0, 96)

function replaceLodashGlobalProbe(): Plugin {
    const unsafeProbe = "Function('return this')()"
    return {
        name: 'job-helper-lodash-global-this',
        enforce: 'pre',
        transform(code, id) {
            const cleanId = id.split('?', 1)[0].replace(/\\/g, '/')
            if (!cleanId.endsWith('/lodash-es/_root.js') && !cleanId.endsWith('/lodash/_root.js')) return null
            const moduleReplacementCount = code.split(unsafeProbe).length - 1
            if (moduleReplacementCount !== 1) {
                this.error(`Expected exactly one lodash global Function probe in ${cleanId}; found ${moduleReplacementCount}`)
            }
            return {code: code.replace(unsafeProbe, 'globalThis'), map: null}
        },
    }
}

function disableLongWasmOptimization(): Plugin {
    function memberName(node: any): string | undefined {
        if (node?.type !== 'MemberExpression') return undefined
        if (!node.computed && node.property?.type === 'Identifier') return node.property.name
        if (node.computed && node.property?.type === 'Literal' && typeof node.property.value === 'string') {
            return node.property.value
        }
        return undefined
    }

    function isIdentifier(node: any, name: string): boolean {
        return node?.type === 'Identifier' && node.name === name
    }

    function isWebAssemblyConstructor(node: any, name: 'Instance' | 'Module'): boolean {
        return node?.type === 'NewExpression'
            && node.callee?.type === 'MemberExpression'
            && isIdentifier(node.callee.object, 'WebAssembly')
            && memberName(node.callee) === name
    }

    function isLongWasmInitializer(statement: any): boolean {
        if (statement?.type !== 'TryStatement' || statement.finalizer
            || !statement.handler || statement.handler.body?.body?.length !== 0
            || statement.block?.body?.length !== 1) return false

        const expression = statement.block.body[0]
        if (expression?.type !== 'ExpressionStatement'
            || expression.expression?.type !== 'AssignmentExpression'
            || expression.expression.operator !== '='
            || !isIdentifier(expression.expression.left, 'wasm')) return false

        const exportedInstance = expression.expression.right
        if (exportedInstance?.type !== 'MemberExpression' || memberName(exportedInstance) !== 'exports') return false
        const instance = exportedInstance.object
        if (!isWebAssemblyConstructor(instance, 'Instance') || instance.arguments.length !== 2
            || instance.arguments[1]?.type !== 'ObjectExpression') return false
        const module = instance.arguments[0]
        if (!isWebAssemblyConstructor(module, 'Module') || module.arguments.length !== 1) return false
        const bytes = module.arguments[0]
        return bytes?.type === 'NewExpression'
            && isIdentifier(bytes.callee, 'Uint8Array')
            && bytes.arguments.length === 1
            && bytes.arguments[0]?.type === 'ArrayExpression'
    }

    return {
        name: 'job-helper-long-js-fallback',
        enforce: 'pre',
        transform(code, id) {
            const cleanId = id.split('?', 1)[0].replace(/\\/g, '/')
            if (!cleanId.endsWith('/long/index.js')) return null

            const program = parse(code, {ecmaVersion: 'latest', sourceType: 'module'})
            const wasmDeclarations = program.body.filter(statement => statement.type === 'VariableDeclaration'
                && statement.kind === 'var'
                && statement.declarations.length === 1
                && statement.declarations[0].id.type === 'Identifier'
                && statement.declarations[0].id.name === 'wasm'
                && statement.declarations[0].init?.type === 'Literal'
                && statement.declarations[0].init.value === null)
            const wasmInitializers = program.body.filter(isLongWasmInitializer)

            if (wasmDeclarations.length !== 1 || wasmInitializers.length !== 1) {
                this.error(`Expected one long.js WASM declaration and initializer in ${cleanId}; found ${wasmDeclarations.length}/${wasmInitializers.length}`)
            }

            const initializer = wasmInitializers[0]!
            return {
                code: `${code.slice(0, initializer.start)}/* MV3: force long.js deterministic JavaScript fallback. */${code.slice(initializer.end)}`,
                map: null,
            }
        },
    }
}

// WXT config API: https://wxt.dev/guide/essentials/config/manifest.html
export default defineConfig({
    // Keep legacy userscript/runtime files in public/ out of the MV3 package.
    publicDir: 'extension-public',
    zip: {
        artifactTemplate: `job-helper-${buildId}-{{browser}}.zip`,
        zipSources: false,
        compressionLevel: 9,
    },
    manifest: {
        name: 'AI工作猎手',
        description: 'AI 工作猎手 Chrome MV3 受控执行扩展',
        version: extensionVersion,
        version_name: `${extensionVersion}+${buildId}`,
        permissions: ['notifications'],
        host_permissions: [
            'http://127.0.0.1:9100/*',
            'https://docdownload.zhipin.com/*',
        ],
        content_security_policy: {
            extension_pages: "script-src 'self'; object-src 'self'",
        },
        web_accessible_resources: [{
            resources: ['job-helper-main.js', 'assets/job-helper-main.css'],
            matches: accessibleResourceMatches,
        }],
    },
    vite: () => ({
        plugins: [
            disableLongWasmOptimization(),
            replaceLodashGlobalProbe(),
            vue({include: [/\.vue$/, /\.md$/]}),
            Markdown(),
            AutoImport({resolvers: [ElementPlusResolver()]}),
            Components({resolvers: [ElementPlusResolver()]}),
        ],
        define: {
            __AI_JOB_HELPER_RUNTIME_VERSION__: JSON.stringify(extensionVersion),
            __AI_JOB_HELPER_BUILD_ID__: JSON.stringify(buildId),
        },
        resolve: {
            extensions: ['.js', '.ts', '.vue', '.json', '.css'],
            alias: {
                '$': fileURLToPath(new URL('./src/extension/gmCompat.ts', import.meta.url)),
                '@protobufjs/inquire': fileURLToPath(new URL('./src/extension/protobufInquire.ts', import.meta.url)),
            },
        },
    }),
})
