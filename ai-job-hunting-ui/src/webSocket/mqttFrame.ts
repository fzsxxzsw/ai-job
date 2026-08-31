export type MqttPublishHeader = {
    flags: number,
    dup: boolean,
    qos: number,
    retain: boolean,
}

export function decodeMqttPublishHeader(buffer: Uint8Array, flagsOverride?: number): MqttPublishHeader {
    const flags = flagsOverride ?? (buffer[0] & 0x0f)
    return {
        flags,
        dup: !!(flags & 8),
        qos: (flags & 6) >> 1,
        retain: !!(flags & 1),
    }
}
