import {readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

const uiRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(uiRoot, 'src'), resolve(uiRoot, 'scripts')]
const legacyTests = new Set(['ai-job-hunting-loader.test.mjs'])

function collectTests(directory, result = []) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) collectTests(path, result)
        else if (entry.isFile() && entry.name.endsWith('.test.mjs') && !legacyTests.has(entry.name)) result.push(path)
    }
    return result
}

const tests = roots.flatMap(root => collectTests(root)).sort()
if (tests.length === 0) throw new Error('No UI tests were found.')

const result = spawnSync(process.execPath, ['--test', ...tests], {
    cwd: uiRoot,
    stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
