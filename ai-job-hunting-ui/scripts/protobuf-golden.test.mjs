import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import test from 'node:test'

const uiRoot = resolve(import.meta.dirname, '..')
const generatorPath = resolve(uiRoot, 'scripts', 'generate-protobuf.mjs')
const protoPath = resolve(uiRoot, 'proto', 'chat-protocol.proto')
const wireGoldenPath = resolve(uiRoot, 'fixtures', 'protobuf-wire-fixtures.json')
const descriptorGoldenPath = resolve(uiRoot, 'fixtures', 'protobuf-descriptor-golden.json')

function runGenerator(args) {
    return spawnSync(process.execPath, [generatorPath, ...args], {
        cwd: uiRoot,
        encoding: 'utf8',
    })
}

test('ordinary protobuf generation and check reject a schema tag drift without updating goldens', async () => {
    const [proto, wireBefore, descriptorBefore] = await Promise.all([
        readFile(protoPath, 'utf8'),
        readFile(wireGoldenPath),
        readFile(descriptorGoldenPath),
    ])
    const oldField = 'required int64 uid = 1;'
    assert.equal(proto.split(oldField).length - 1 >= 1, true, 'mutation anchor must exist')
    const mutatedProto = proto.replace(oldField, 'required int64 uid = 101;')
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'job-helper-protobuf-negative-'))
    const mutatedProtoPath = resolve(tempRoot, 'chat-protocol.proto')

    try {
        await writeFile(mutatedProtoPath, mutatedProto, 'utf8')
        for (const args of [['--proto', mutatedProtoPath], ['--check', '--proto', mutatedProtoPath]]) {
            const result = runGenerator(args)
            assert.notEqual(result.status, 0, `generator unexpectedly accepted schema drift: ${args.join(' ')}`)
            assert.match(`${result.stdout}${result.stderr}`, /artifact drifted/)
        }
        const [wireAfter, descriptorAfter] = await Promise.all([
            readFile(wireGoldenPath),
            readFile(descriptorGoldenPath),
        ])
        assert.deepEqual(wireAfter, wireBefore, 'ordinary generation must not rewrite the wire golden')
        assert.deepEqual(descriptorAfter, descriptorBefore, 'ordinary generation must not rewrite the descriptor golden')
    } finally {
        await rm(tempRoot, {recursive: true, force: true})
    }
})
