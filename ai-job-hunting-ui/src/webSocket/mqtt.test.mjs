import assert from 'node:assert/strict'
import test from 'node:test'
import {decodeMqttPublishHeader} from './mqttFrame.ts'

test('MQTT decoder derives QoS 0 from the real fixed header', () => {
    assert.deepEqual(decodeMqttPublishHeader(Uint8Array.from([0x30])), {
        flags: 0,
        dup: false,
        qos: 0,
        retain: false,
    })
})

test('MQTT decoder derives QoS 1 instead of assuming it for every frame', () => {
    assert.deepEqual(decodeMqttPublishHeader(Uint8Array.from([0x32])), {
        flags: 2,
        dup: false,
        qos: 1,
        retain: false,
    })
})
