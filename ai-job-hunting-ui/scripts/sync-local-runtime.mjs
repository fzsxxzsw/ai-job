import {copyFileSync, mkdirSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(uiRoot, '..');
const runtimeSource = resolve(uiRoot, 'dist', 'ai-job-hunting.user.js');
const loaderSource = resolve(uiRoot, 'scripts', 'ai-job-hunting-loader.user.js');
const runtimeTargets = [
    resolve(uiRoot, 'public', 'ai-job-hunting-runtime.js'),
];
const loaderTargets = [
    resolve(uiRoot, 'public', 'ai-job-hunting-local.user.js'),
    resolve(uiRoot, 'dist', 'ai-job-hunting-local.user.js'),
    resolve(workspaceRoot, 'ai-job-hunting-local.user.js'),
];

const runtimeText = readFileSync(runtimeSource, 'utf8');
const forbiddenRuntimeMarkers = [
    ['SystemJS module wrapper', /\bSystem\.register\s*\(/],
    ['SystemJS entry import', /\bSystem\.import\s*\(/],
    ['external SystemJS CDN dependency', /@require\s+https?:\/\/[^\n]*system(?:\.min)?\.js/i],
];
for (const [label, pattern] of forbiddenRuntimeMarkers) {
    if (pattern.test(runtimeText)) {
        throw new Error(`Local runtime contract failed: found ${label}. The local build must be a self-contained IIFE.`);
    }
}
if (!runtimeText.includes('__AI_JOB_HELPER_RUNTIME_STATUS__')) {
    throw new Error('Local runtime contract failed: lifecycle status marker is missing.');
}

if (process.argv.includes('--validate-only')) {
    console.info('Validated self-contained local runtime; no served files were changed.');
    process.exit(0);
}

async function atomicCopy(source, target) {
    mkdirSync(dirname(target), {recursive: true});
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    try {
        copyFileSync(source, temporary);
        for (let attempt = 1; ; attempt++) {
            try {
                renameSync(temporary, target);
                break;
            } catch (error) {
                const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
                if (!retryable || attempt >= 5) throw error;
                await new Promise(resolve => setTimeout(resolve, 40 * attempt));
            }
        }
    } finally {
        rmSync(temporary, {force: true});
    }
}

for (const target of runtimeTargets) {
    await atomicCopy(runtimeSource, target);
}
for (const target of loaderTargets) {
    await atomicCopy(loaderSource, target);
}

console.info(`Synced runtime to ${runtimeTargets.length} targets and stable loader to ${loaderTargets.length} targets.`);
