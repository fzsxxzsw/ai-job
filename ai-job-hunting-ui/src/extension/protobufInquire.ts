import Long from 'long'

/**
 * Browser-only replacement for protobufjs' dynamic Node require probe.
 * Returning Long preserves exact int64 handling without eval/new Function;
 * fs and Buffer probing deliberately remain unavailable in the extension.
 */
export default function protobufInquire(moduleName: string): unknown {
    return moduleName === 'long' ? Long : null
}
