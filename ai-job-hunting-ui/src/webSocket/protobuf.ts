import {protobufType} from './protobufRuntime'
import {Tools} from "../platform/utils";
import logging from "../logging";
import {LogRecorder} from "../logging/record";
import {nextClientMid} from "./clientMid";
const logRecorder: LogRecorder = new LogRecorder('call');

interface TechwolfUser {
    //  @int64
    uid: string | number; // 1
    name: string; // 2
    //  @int32
    source?: number; // 7
    avatar: string,
}
interface TechwolfMessageBody {
    //  @int32
    type: number; // 1
    //  @int32
    templateId: number; // 2
    headTitle?: string; // 11
    text: string; // 3
}

interface TechwolfMessage {
    from: TechwolfUser; // 1
    to: TechwolfUser; // 2
    //  @int32
    type?: number; // 3
    //  @int64
    mid?: string; // 4
    //  @int64
    time?: string; // 5
    body: TechwolfMessageBody; // 6
    //  @int64
    cmid?: string; // 11
    offline?: boolean; // 7
}


export interface TechwolfChatProtocol {
    //  @int32
    type: number; // 1
    messages: TechwolfMessage[]; // 3
}

export {protobufType} from './protobufRuntime'

export class Message {
    msg: Uint8Array;
    msgObj: any;
    hex: string;

    static createClientMid(): string {
        return nextClientMid()
    }

    constructor({
                    form_uid,
                    to_uid,
                    to_name,
                    content,
                    image,
                    clientMid,
                }: {
        form_uid: string;
        to_uid: string;
        to_name: string;
        content: string;
        image: { originImage: string, tinyImage: string } | undefined;
        clientMid?: string;
    }) {
        const r = new Date().getTime();
        // A retry must keep the same clientMid. BOSS can then de-duplicate a message
        // whose server ACK was lost, instead of treating every retry as new content.
        const d = clientMid || Message.createClientMid();
        const data: any = {
            messages: [
                {
                    from: {
                        uid: form_uid,
                        source: 0,
                    },
                    to: {
                        uid: to_uid,
                        name: to_name,
                        source: 0,
                    },
                    type: 1,
                    mid: d,
                    time: r.toString(),
                    body: {
                        type: image ? 3 : 1,
                        templateId: 1,
                        text: image ? null : content,
                        image: image ? {
                            originImage: {
                                url: image.originImage,
                            },
                            tinyImage: {
                                url: image.tinyImage,
                            }
                        } : {}
                    },
                    cmid: d,
                },
            ],
            type: 1,
        };

        this.msgObj = data.messages[0];
        this.msg = protobufType.encode(data).finish().slice();
        this.hex = [...this.msg]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }


    toArrayBuffer(): ArrayBuffer {
        return this.msg.buffer.slice(0, this.msg.byteLength);
    }

    async send(retries: number = 3, retryDelayMs: number = 500): Promise<boolean> {
        let initAttempted = false;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // A one-shot caller used to call ensureReady and then immediately
                // leave the loop without ever sending. Resolve readiness first,
                // then attempt the write in the same iteration.
                if (!Tools.window.AIJobHelperChatBridge?.isReady?.() && !initAttempted) {
                    initAttempted = true;
                    await Promise.resolve(Tools.window.AIJobHelperChatBridge?.ensureReady?.(8_000))
                }
                // Only the bridge resolves true after BOSS returns messageSync for this
                // exact clientMid. Merely invoking a legacy send method is not delivery
                // evidence and must never clear a greeting/AI-reply retry queue.
                if (Tools.window.AIJobHelperChatBridge?.isReady?.()
                    && await Promise.resolve(Tools.window.AIJobHelperChatBridge.send(this))) {
                    return true;
                }
            } catch (e) {
                logRecorder.warn(`消息发送通道第${attempt}次尝试失败`, e)
            }
            if (attempt < retries) {
                await Tools.sleep(retryDelayMs)
            }
        }
        if (Number((this.msgObj as any).__dispatchedAt || 0) > 0) {
            logRecorder.warn(this.msgObj.body.type === 3
                ? "图片消息已交给BOSS SDK，ACK暂未返回；已暂停重发"
                : "文本消息已交给BOSS SDK，ACK暂未返回；已暂停重发")
        } else {
            logRecorder.error(this.msgObj.body.type === 3
                ? "发送图片消息失败：通道未就绪"
                : "发送文本消息失败：通道未就绪")
        }
        return false;
    }
}


export class MessageRead {
    msg: Uint8Array;
    hex: string;
    userId: string;
    messageId: string;

    constructor({userId, messageId,}: {
        userId: string;
        messageId: string;
    }) {
        this.userId = String(userId)
        this.messageId = String(messageId)
        const r = new Date().getTime();
        const d = r + 68256432452609;
        const data: any = {
            messageRead: [
                {
                    messageId: messageId,
                    readTime: r,
                    userId: userId,
                    userSource: 0,
                },
            ],
            type: 6,
        };

        this.msg = protobufType.encode(data).finish().slice();
        this.hex = [...this.msg]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }


    toArrayBuffer(): ArrayBuffer {
        return this.msg.buffer.slice(0, this.msg.byteLength);
    }

    async send(): Promise<boolean> {
        const bridgeRead = Tools.window.AIJobHelperChatBridge?.sendRead
        if (bridgeRead) {
            try {
                if (await Promise.resolve(bridgeRead.call(
                    Tools.window.AIJobHelperChatBridge,
                    this.userId,
                    this.messageId,
                ))) return true
            } catch (error) {
                logRecorder.warn('已读回执 GeekChatCore 发送失败，尝试原生兼容通道', error)
            }
        }
        const bridgeSend = Tools.window.AIJobHelperChatBridge?.send
        if (bridgeSend) {
            try {
                // The bridge is async. Testing the Promise object itself would always be
                // truthy and silently suppress the legacy read-receipt fallback on `false`.
                if (await Promise.resolve(bridgeSend.call(Tools.window.AIJobHelperChatBridge, this))) {
                    return true
                }
            } catch (error) {
                logRecorder.warn('已读回执 bridge 发送失败，尝试兼容通道', error)
            }
        }
        if (Tools.window.ChatWebsocket?.send) {
            try {
                await Promise.resolve(Tools.window.ChatWebsocket.send(this))
                return true
            } catch (error) {
                logRecorder.warn('已读回执 ChatWebsocket 发送失败，尝试图片通道', error)
            }
        }
        if (Tools.window.ChatWebsocketImage?.send) {
            try {
                await Promise.resolve(Tools.window.ChatWebsocketImage.send(this))
                return true
            } catch (error) {
                logRecorder.warn('已读回执兼容通道发送失败', error)
            }
        }
        return false
    }
}
