import Long from 'long'
import protobuf from 'protobufjs/minimal'
import {TechwolfChatProtocol as StaticTechwolfChatProtocol} from './generated/chat-protocol.js'

// protobufjs/minimal contains only the reader/writer runtime. Keep one explicit
// Long implementation so decoded int64 values never fall back to imprecise numbers.
protobuf.util.Long = Long
protobuf.configure()

export const protobufType = StaticTechwolfChatProtocol
