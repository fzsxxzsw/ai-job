import assert from 'node:assert/strict'
import {readdir, readFile, stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve, relative} from 'node:path'
import {findForbiddenJavaScript} from './extension-contract-scanner.mjs'

const uiRoot = resolve(import.meta.dirname, '..')
const outputRoot = resolve(uiRoot, '.output', 'chrome-mv3')
const manifestPath = resolve(outputRoot, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const expectedMatches = [
    'https://www.zhipin.com/overseas/*',
    'https://www.zhipin.com/web/geek/*',
]
const expectedAccessibleResourceMatches = ['https://www.zhipin.com/*']
const expectedHosts = [
    'http://127.0.0.1:9100/*',
    'https://docdownload.zhipin.com/*',
]
const expectedBuildId = String(process.env.JOB_HELPER_BUILD_ID || 'dev-local').replace(/[^0-9A-Za-z._-]/g, '-').slice(0, 96)
const zipPath = resolve(uiRoot, '.output', `job-helper-${expectedBuildId}-chrome.zip`)
const expectedExtensionCsp = "script-src 'self'; object-src 'self'"

function normalizeCsp(value) {
    assert.equal(typeof value, 'string', 'extension_pages CSP must be a string')
    return value.split(';')
        .map(directive => directive.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join('; ')
}

assert.equal(manifest.manifest_version, 3, 'manifest must be MV3')
assert.equal(manifest.version_name.includes(expectedBuildId), true, 'version_name must contain the build id')
assert.deepEqual([...(manifest.host_permissions || [])].sort(), expectedHosts.sort(), 'host permissions must stay exact')
assert.equal(JSON.stringify(manifest).includes('9101'), false, 'Python 9101 must not be exposed to the browser extension')
assert.deepEqual(manifest.permissions, ['notifications'], 'only notification privilege is allowed')
assert.deepEqual(Object.keys(manifest.content_security_policy || {}), ['extension_pages'],
    'only the extension_pages CSP is allowed')
assert.equal(normalizeCsp(manifest.content_security_policy?.extension_pages), expectedExtensionCsp,
    `extension_pages CSP must be exactly ${expectedExtensionCsp}`)
assert.equal(manifest.content_scripts?.length, 1, 'exactly one isolated bridge content script is expected')
const contentScript = manifest.content_scripts[0]
assert.deepEqual([...contentScript.matches].sort(), expectedMatches.sort(), 'content matches must stay exact')
assert.equal(contentScript.run_at, 'document_start')
assert.equal(contentScript.all_frames, false)
assert.equal(contentScript.world === undefined || contentScript.world === 'ISOLATED', true)
const accessibleResources = manifest.web_accessible_resources?.flatMap(entry => entry.resources || []) || []
assert.deepEqual([...accessibleResources].sort(), ['assets/job-helper-main.css', 'job-helper-main.js'])
assert.equal(manifest.web_accessible_resources?.length, 1, 'exactly one web-accessible resource declaration is expected')
assert.deepEqual(
    [...(manifest.web_accessible_resources[0].matches || [])].sort(),
    expectedAccessibleResourceMatches,
    'web-accessible resources must use Chrome-valid origin-wide matches',
)

async function collectFiles(directory, result = []) {
    for (const name of await readdir(directory)) {
        const path = resolve(directory, name)
        if ((await stat(path)).isDirectory()) await collectFiles(path, result)
        else result.push(path)
    }
    return result
}

const files = await collectFiles(outputRoot)
assert.equal(files.some(path => path.endsWith('job-helper-main.js')), true, 'main-world bundle is missing')
assert.equal(files.some(path => path.endsWith('assets\\job-helper-main.css') || path.endsWith('assets/job-helper-main.css')), true,
    'main-world styles are missing')
assert.equal(files.some(path => path.endsWith('.user.js')), false, 'userscript files cannot enter the extension')
assert.equal(files.some(path => path.endsWith('.wasm')), false, 'WebAssembly assets cannot enter the extension')
const textFiles = files.filter(path => /\.(?:css|html|js|json|map)$/.test(path))
const forbidden = [
    {name: '5173 runtime URL', pattern: /127\.0\.0\.1:5173/},
    {name: 'userscript metadata', pattern: /==UserScript==|@grant\b/},
    {name: 'remote dependency script', pattern: /(?:cdn\.jsdelivr\.net|unpkg\.com|gitee\.com\/yangfeng20\/ai-job\/raw)/},
    {name: '.wasm reference', pattern: /\.wasm\b/i},
]
for (const path of textFiles) {
    const source = await readFile(path, 'utf8')
    for (const rule of forbidden) {
        assert.equal(rule.pattern.test(source), false, `${rule.name} found in ${relative(outputRoot, path)}`)
    }
    if (path.endsWith('.js')) {
        const findings = findForbiddenJavaScript(source, relative(outputRoot, path))
        assert.deepEqual(findings, [], `Forbidden runtime code found in ${relative(outputRoot, path)}: ${JSON.stringify(findings)}`)
    }
}

if (process.argv.includes('--require-zip')) {
    const zipBytes = await readFile(zipPath)
    assert.equal(zipBytes.length > 0, true, 'extension zip must not be empty')
    assert.equal(zipBytes[0], 0x50, 'extension zip signature is invalid')
    assert.equal(zipBytes[1], 0x4b, 'extension zip signature is invalid')
    console.log(`Extension zip verified: ${relative(uiRoot, zipPath)} sha256=${createHash('sha256').update(zipBytes).digest('hex')}`)
}

console.log(`Extension contract verified: ${relative(uiRoot, outputRoot)} (${files.length} files)`)
