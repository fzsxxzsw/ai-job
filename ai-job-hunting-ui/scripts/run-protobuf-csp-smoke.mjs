import {spawnSync} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {build} from 'esbuild'

const uiRoot = resolve(import.meta.dirname, '..')
const tempRoot = await mkdtemp(resolve(tmpdir(), 'job-helper-protobuf-csp-'))
const outputPath = resolve(tempRoot, 'protobuf-csp-smoke.bundle.mjs')
const aliases = new Map([
    ['$', resolve(uiRoot, 'src', 'extension', 'gmCompat.ts')],
])

try {
    await build({
        entryPoints: [resolve(uiRoot, 'scripts', 'protobuf-csp-smoke.mjs')],
        outfile: outputPath,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node24',
        sourcemap: false,
        define: {
            __AI_JOB_HELPER_RUNTIME_VERSION__: JSON.stringify('protobuf-csp-smoke'),
            __AI_JOB_HELPER_BUILD_ID__: JSON.stringify('protobuf-csp-smoke'),
        },
        plugins: [{
            name: 'job-helper-protobuf-smoke-aliases',
            setup(buildApi) {
                buildApi.onResolve({filter: /^\$$/}, args => ({
                    path: aliases.get(args.path),
                }))
                buildApi.onResolve({filter: /^@protobufjs\/inquire$/}, () => ({
                    path: 'protobuf-csp-inquire',
                    namespace: 'job-helper-csp',
                }))
                buildApi.onLoad({filter: /.*/, namespace: 'job-helper-csp'}, () => ({
                    contents: "const Long = require('long'); module.exports = name => name === 'long' ? Long : null;",
                    loader: 'js',
                    resolveDir: uiRoot,
                }))
            },
        }],
    })

    const result = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', outputPath], {
        cwd: uiRoot,
        encoding: 'utf8',
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
    await rm(tempRoot, {recursive: true, force: true})
}
