import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import Long from 'long'
import protobufModule from 'protobufjs'

const uiRoot = resolve(import.meta.dirname, '..')
const protoArgumentIndex = process.argv.indexOf('--proto')
if (protoArgumentIndex >= 0 && !process.argv[protoArgumentIndex + 1]) {
    throw new Error('--proto requires a path')
}
const protoPath = protoArgumentIndex >= 0
    ? resolve(process.argv[protoArgumentIndex + 1])
    : resolve(uiRoot, 'proto', 'chat-protocol.proto')
const generatedJsPath = resolve(uiRoot, 'src', 'webSocket', 'generated', 'chat-protocol.js')
const generatedDtsPath = resolve(uiRoot, 'src', 'webSocket', 'generated', 'chat-protocol.d.ts')
const fixturePath = resolve(uiRoot, 'fixtures', 'protobuf-wire-fixtures.json')
const descriptorPath = resolve(uiRoot, 'fixtures', 'protobuf-descriptor-golden.json')
const protobufPackagePath = resolve(uiRoot, 'node_modules', 'protobufjs', 'package.json')
const longPackagePath = resolve(uiRoot, 'node_modules', 'long', 'package.json')
const pbjsPath = resolve(uiRoot, 'node_modules', 'protobufjs-cli', 'bin', 'pbjs')
const pbtsPath = resolve(uiRoot, 'node_modules', 'protobufjs-cli', 'bin', 'pbts')
const checkOnly = process.argv.includes('--check')
const updateGolden = process.argv.includes('--update-golden')

if (checkOnly && updateGolden) throw new Error('--check and --update-golden are mutually exclusive')

const fixtureValues = [
    {
        name: 'outbound-message',
        value: {
            messages: [{
                from: {uid: '9223372036854775806', source: 0},
                to: {uid: '9007199254740993', name: '招聘者', source: 0},
                type: 1,
                mid: '7500000000000001',
                time: '1760000000000',
                body: {type: 1, templateId: 1, text: '你好，静态 protobuf', image: {}},
                cmid: '7500000000000001',
            }],
            type: 1,
        },
    },
    {
        name: 'message-read',
        value: {
            messageRead: [{
                userId: '9223372036854775806',
                messageId: '9007199254740993',
                readTime: 1760000000000,
                userSource: 0,
            }],
            type: 6,
        },
    },
    {
        name: 'inbound-message',
        value: {
            messages: [{
                from: {uid: '9223372036854775806', name: '招聘者', source: 0},
                to: {uid: '9007199254740993', name: '求职者', source: 0},
                type: 1,
                mid: '9223372036854775805',
                time: '1760000000000',
                body: {type: 1, templateId: 1, text: '入站消息'},
                cmid: '7500000000000002',
            }],
            type: 1,
        },
    },
]

function runNodeScript(scriptPath, args) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: uiRoot,
        encoding: 'utf8',
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
        throw new Error(`${scriptPath} failed (${result.status}):\n${result.stdout}${result.stderr}`)
    }
}

function toHex(bytes) {
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function buildProtocolGoldens() {
    const protobuf = protobufModule.default || protobufModule
    protobuf.util.Long = Long
    protobuf.configure()
    const source = await readFile(protoPath, 'utf8')
    const root = protobuf.parse(source).root
    const reflectedType = root.lookupType('TechwolfChatProtocol')
    const [{version: protobufjsVersion}, {version: longVersion}] = await Promise.all([
        readFile(protobufPackagePath, 'utf8').then(JSON.parse),
        readFile(longPackagePath, 'utf8').then(JSON.parse),
    ])
    const cases = fixtureValues.map(({name, value}) => ({
        name,
        value,
        expectedHex: toHex(reflectedType.encode(value).finish()),
    }))
    const wire = `${JSON.stringify({
        generator: 'committed protobuf wire golden (explicit updates only)',
        protobufjsVersion,
        longVersion,
        cases,
    }, null, 2)}\n`
    const descriptor = `${JSON.stringify({
        generator: 'committed protobuf descriptor golden (explicit updates only)',
        protobufjsVersion,
        schema: root.toJSON(),
    }, null, 2)}\n`
    return {wire, descriptor}
}

async function assertSame(expectedPath, actualPath) {
    const [expected, actual] = await Promise.all([
        readFile(expectedPath),
        readFile(actualPath),
    ])
    assert.deepEqual(actual, expected, `Generated protobuf artifact drifted: ${expectedPath}`)
}

const tempRoot = await mkdtemp(resolve(tmpdir(), 'job-helper-protobuf-'))
const tempJsPath = resolve(tempRoot, 'chat-protocol.js')
const tempDtsPath = resolve(tempRoot, 'chat-protocol.d.ts')
const tempFixturePath = resolve(tempRoot, 'protobuf-wire-fixtures.json')
const tempDescriptorPath = resolve(tempRoot, 'protobuf-descriptor-golden.json')

try {
    const goldens = await buildProtocolGoldens()
    await Promise.all([
        writeFile(tempFixturePath, goldens.wire, 'utf8'),
        writeFile(tempDescriptorPath, goldens.descriptor, 'utf8'),
    ])

    if (updateGolden) {
        await mkdir(dirname(fixturePath), {recursive: true})
        await Promise.all([
            writeFile(fixturePath, goldens.wire, 'utf8'),
            writeFile(descriptorPath, goldens.descriptor, 'utf8'),
        ])
        console.log('Updated committed protobuf wire and descriptor goldens explicitly.')
    } else {
        runNodeScript(pbjsPath, [
            '--target', 'static-module',
            '--wrap', 'es6',
            '--force-long',
            '--no-verify',
            '--no-convert',
            '--no-delimited',
            '--no-typeurl',
            '--out', tempJsPath,
            protoPath,
        ])
        runNodeScript(pbtsPath, ['--out', tempDtsPath, tempJsPath])

        await assertSame(fixturePath, tempFixturePath)
        await assertSame(descriptorPath, tempDescriptorPath)

        if (checkOnly) {
            await assertSame(generatedJsPath, tempJsPath)
            await assertSame(generatedDtsPath, tempDtsPath)
            console.log('Generated protobuf artifacts and committed goldens are current.')
        } else {
            await mkdir(dirname(generatedJsPath), {recursive: true})
            await Promise.all([
                writeFile(generatedJsPath, await readFile(tempJsPath)),
                writeFile(generatedDtsPath, await readFile(tempDtsPath)),
            ])
            console.log('Generated protobuf static module and declarations; committed goldens were not changed.')
        }
    }
} finally {
    await rm(tempRoot, {recursive: true, force: true})
}
