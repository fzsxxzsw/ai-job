/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const TechwolfUser = $root.TechwolfUser = (() => {

    /**
     * Properties of a TechwolfUser.
     * @exports ITechwolfUser
     * @interface ITechwolfUser
     * @property {Long} uid TechwolfUser uid
     * @property {string|null} [name] TechwolfUser name
     * @property {string|null} [avatar] TechwolfUser avatar
     * @property {string|null} [company] TechwolfUser company
     * @property {number|null} [headImg] TechwolfUser headImg
     * @property {number|null} [certification] TechwolfUser certification
     * @property {number|null} [source] TechwolfUser source
     */

    /**
     * Constructs a new TechwolfUser.
     * @exports TechwolfUser
     * @classdesc Represents a TechwolfUser.
     * @implements ITechwolfUser
     * @constructor
     * @param {ITechwolfUser=} [properties] Properties to set
     */
    function TechwolfUser(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfUser uid.
     * @member {Long} uid
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.uid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfUser name.
     * @member {string} name
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.name = "";

    /**
     * TechwolfUser avatar.
     * @member {string} avatar
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.avatar = "";

    /**
     * TechwolfUser company.
     * @member {string} company
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.company = "";

    /**
     * TechwolfUser headImg.
     * @member {number} headImg
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.headImg = 0;

    /**
     * TechwolfUser certification.
     * @member {number} certification
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.certification = 0;

    /**
     * TechwolfUser source.
     * @member {number} source
     * @memberof TechwolfUser
     * @instance
     */
    TechwolfUser.prototype.source = 0;

    /**
     * Creates a new TechwolfUser instance using the specified properties.
     * @function create
     * @memberof TechwolfUser
     * @static
     * @param {ITechwolfUser=} [properties] Properties to set
     * @returns {TechwolfUser} TechwolfUser instance
     */
    TechwolfUser.create = function create(properties) {
        return new TechwolfUser(properties);
    };

    /**
     * Encodes the specified TechwolfUser message. Does not implicitly {@link TechwolfUser.verify|verify} messages.
     * @function encode
     * @memberof TechwolfUser
     * @static
     * @param {ITechwolfUser} message TechwolfUser message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfUser.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.uid);
        if (message.name != null && Object.hasOwnProperty.call(message, "name"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.name);
        if (message.avatar != null && Object.hasOwnProperty.call(message, "avatar"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.avatar);
        if (message.company != null && Object.hasOwnProperty.call(message, "company"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.company);
        if (message.headImg != null && Object.hasOwnProperty.call(message, "headImg"))
            writer.uint32(/* id 5, wireType 0 =*/40).int32(message.headImg);
        if (message.certification != null && Object.hasOwnProperty.call(message, "certification"))
            writer.uint32(/* id 6, wireType 0 =*/48).int32(message.certification);
        if (message.source != null && Object.hasOwnProperty.call(message, "source"))
            writer.uint32(/* id 7, wireType 0 =*/56).int32(message.source);
        return writer;
    };

    /**
     * Decodes a TechwolfUser message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfUser
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfUser} TechwolfUser
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfUser.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfUser();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.uid = reader.int64();
                    break;
                }
            case 2: {
                    message.name = reader.string();
                    break;
                }
            case 3: {
                    message.avatar = reader.string();
                    break;
                }
            case 4: {
                    message.company = reader.string();
                    break;
                }
            case 5: {
                    message.headImg = reader.int32();
                    break;
                }
            case 6: {
                    message.certification = reader.int32();
                    break;
                }
            case 7: {
                    message.source = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("uid"))
            throw $util.ProtocolError("missing required 'uid'", { instance: message });
        return message;
    };

    return TechwolfUser;
})();

export const TechwolfSound = $root.TechwolfSound = (() => {

    /**
     * Properties of a TechwolfSound.
     * @exports ITechwolfSound
     * @interface ITechwolfSound
     * @property {Long|null} [sid] TechwolfSound sid
     * @property {string|null} [url] TechwolfSound url
     * @property {number|null} [duration] TechwolfSound duration
     * @property {number|null} [templateId] TechwolfSound templateId
     */

    /**
     * Constructs a new TechwolfSound.
     * @exports TechwolfSound
     * @classdesc Represents a TechwolfSound.
     * @implements ITechwolfSound
     * @constructor
     * @param {ITechwolfSound=} [properties] Properties to set
     */
    function TechwolfSound(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfSound sid.
     * @member {Long} sid
     * @memberof TechwolfSound
     * @instance
     */
    TechwolfSound.prototype.sid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfSound url.
     * @member {string} url
     * @memberof TechwolfSound
     * @instance
     */
    TechwolfSound.prototype.url = "";

    /**
     * TechwolfSound duration.
     * @member {number} duration
     * @memberof TechwolfSound
     * @instance
     */
    TechwolfSound.prototype.duration = 0;

    /**
     * TechwolfSound templateId.
     * @member {number} templateId
     * @memberof TechwolfSound
     * @instance
     */
    TechwolfSound.prototype.templateId = 0;

    /**
     * Creates a new TechwolfSound instance using the specified properties.
     * @function create
     * @memberof TechwolfSound
     * @static
     * @param {ITechwolfSound=} [properties] Properties to set
     * @returns {TechwolfSound} TechwolfSound instance
     */
    TechwolfSound.create = function create(properties) {
        return new TechwolfSound(properties);
    };

    /**
     * Encodes the specified TechwolfSound message. Does not implicitly {@link TechwolfSound.verify|verify} messages.
     * @function encode
     * @memberof TechwolfSound
     * @static
     * @param {ITechwolfSound} message TechwolfSound message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfSound.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.sid != null && Object.hasOwnProperty.call(message, "sid"))
            writer.uint32(/* id 1, wireType 0 =*/8).int64(message.sid);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
        if (message.duration != null && Object.hasOwnProperty.call(message, "duration"))
            writer.uint32(/* id 3, wireType 0 =*/24).int32(message.duration);
        if (message.templateId != null && Object.hasOwnProperty.call(message, "templateId"))
            writer.uint32(/* id 4, wireType 0 =*/32).int32(message.templateId);
        return writer;
    };

    /**
     * Decodes a TechwolfSound message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfSound
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfSound} TechwolfSound
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfSound.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfSound();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.sid = reader.int64();
                    break;
                }
            case 2: {
                    message.url = reader.string();
                    break;
                }
            case 3: {
                    message.duration = reader.int32();
                    break;
                }
            case 4: {
                    message.templateId = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfSound;
})();

export const TechwolfVideo = $root.TechwolfVideo = (() => {

    /**
     * Properties of a TechwolfVideo.
     * @exports ITechwolfVideo
     * @interface ITechwolfVideo
     * @property {number} type TechwolfVideo type
     * @property {number} status TechwolfVideo status
     * @property {number|null} [duration] TechwolfVideo duration
     * @property {string|null} [text] TechwolfVideo text
     */

    /**
     * Constructs a new TechwolfVideo.
     * @exports TechwolfVideo
     * @classdesc Represents a TechwolfVideo.
     * @implements ITechwolfVideo
     * @constructor
     * @param {ITechwolfVideo=} [properties] Properties to set
     */
    function TechwolfVideo(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfVideo type.
     * @member {number} type
     * @memberof TechwolfVideo
     * @instance
     */
    TechwolfVideo.prototype.type = 0;

    /**
     * TechwolfVideo status.
     * @member {number} status
     * @memberof TechwolfVideo
     * @instance
     */
    TechwolfVideo.prototype.status = 0;

    /**
     * TechwolfVideo duration.
     * @member {number} duration
     * @memberof TechwolfVideo
     * @instance
     */
    TechwolfVideo.prototype.duration = 0;

    /**
     * TechwolfVideo text.
     * @member {string} text
     * @memberof TechwolfVideo
     * @instance
     */
    TechwolfVideo.prototype.text = "";

    /**
     * Creates a new TechwolfVideo instance using the specified properties.
     * @function create
     * @memberof TechwolfVideo
     * @static
     * @param {ITechwolfVideo=} [properties] Properties to set
     * @returns {TechwolfVideo} TechwolfVideo instance
     */
    TechwolfVideo.create = function create(properties) {
        return new TechwolfVideo(properties);
    };

    /**
     * Encodes the specified TechwolfVideo message. Does not implicitly {@link TechwolfVideo.verify|verify} messages.
     * @function encode
     * @memberof TechwolfVideo
     * @static
     * @param {ITechwolfVideo} message TechwolfVideo message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfVideo.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.status);
        if (message.duration != null && Object.hasOwnProperty.call(message, "duration"))
            writer.uint32(/* id 3, wireType 0 =*/24).int32(message.duration);
        if (message.text != null && Object.hasOwnProperty.call(message, "text"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.text);
        return writer;
    };

    /**
     * Decodes a TechwolfVideo message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfVideo
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfVideo} TechwolfVideo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfVideo.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfVideo();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.status = reader.int32();
                    break;
                }
            case 3: {
                    message.duration = reader.int32();
                    break;
                }
            case 4: {
                    message.text = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        if (!message.hasOwnProperty("status"))
            throw $util.ProtocolError("missing required 'status'", { instance: message });
        return message;
    };

    return TechwolfVideo;
})();

export const TechwolfInterview = $root.TechwolfInterview = (() => {

    /**
     * Properties of a TechwolfInterview.
     * @exports ITechwolfInterview
     * @interface ITechwolfInterview
     * @property {number} condition TechwolfInterview condition
     * @property {string} text TechwolfInterview text
     * @property {string|null} [url] TechwolfInterview url
     * @property {string|null} [extend] TechwolfInterview extend
     */

    /**
     * Constructs a new TechwolfInterview.
     * @exports TechwolfInterview
     * @classdesc Represents a TechwolfInterview.
     * @implements ITechwolfInterview
     * @constructor
     * @param {ITechwolfInterview=} [properties] Properties to set
     */
    function TechwolfInterview(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfInterview condition.
     * @member {number} condition
     * @memberof TechwolfInterview
     * @instance
     */
    TechwolfInterview.prototype.condition = 0;

    /**
     * TechwolfInterview text.
     * @member {string} text
     * @memberof TechwolfInterview
     * @instance
     */
    TechwolfInterview.prototype.text = "";

    /**
     * TechwolfInterview url.
     * @member {string} url
     * @memberof TechwolfInterview
     * @instance
     */
    TechwolfInterview.prototype.url = "";

    /**
     * TechwolfInterview extend.
     * @member {string} extend
     * @memberof TechwolfInterview
     * @instance
     */
    TechwolfInterview.prototype.extend = "";

    /**
     * Creates a new TechwolfInterview instance using the specified properties.
     * @function create
     * @memberof TechwolfInterview
     * @static
     * @param {ITechwolfInterview=} [properties] Properties to set
     * @returns {TechwolfInterview} TechwolfInterview instance
     */
    TechwolfInterview.create = function create(properties) {
        return new TechwolfInterview(properties);
    };

    /**
     * Encodes the specified TechwolfInterview message. Does not implicitly {@link TechwolfInterview.verify|verify} messages.
     * @function encode
     * @memberof TechwolfInterview
     * @static
     * @param {ITechwolfInterview} message TechwolfInterview message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfInterview.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.condition);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.text);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.url);
        if (message.extend != null && Object.hasOwnProperty.call(message, "extend"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.extend);
        return writer;
    };

    /**
     * Decodes a TechwolfInterview message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfInterview
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfInterview} TechwolfInterview
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfInterview.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfInterview();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.condition = reader.int32();
                    break;
                }
            case 2: {
                    message.text = reader.string();
                    break;
                }
            case 3: {
                    message.url = reader.string();
                    break;
                }
            case 4: {
                    message.extend = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("condition"))
            throw $util.ProtocolError("missing required 'condition'", { instance: message });
        if (!message.hasOwnProperty("text"))
            throw $util.ProtocolError("missing required 'text'", { instance: message });
        return message;
    };

    return TechwolfInterview;
})();

export const TechwolfImageInfo = $root.TechwolfImageInfo = (() => {

    /**
     * Properties of a TechwolfImageInfo.
     * @exports ITechwolfImageInfo
     * @interface ITechwolfImageInfo
     * @property {string} url TechwolfImageInfo url
     * @property {number} width TechwolfImageInfo width
     * @property {number} height TechwolfImageInfo height
     */

    /**
     * Constructs a new TechwolfImageInfo.
     * @exports TechwolfImageInfo
     * @classdesc Represents a TechwolfImageInfo.
     * @implements ITechwolfImageInfo
     * @constructor
     * @param {ITechwolfImageInfo=} [properties] Properties to set
     */
    function TechwolfImageInfo(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfImageInfo url.
     * @member {string} url
     * @memberof TechwolfImageInfo
     * @instance
     */
    TechwolfImageInfo.prototype.url = "";

    /**
     * TechwolfImageInfo width.
     * @member {number} width
     * @memberof TechwolfImageInfo
     * @instance
     */
    TechwolfImageInfo.prototype.width = 0;

    /**
     * TechwolfImageInfo height.
     * @member {number} height
     * @memberof TechwolfImageInfo
     * @instance
     */
    TechwolfImageInfo.prototype.height = 0;

    /**
     * Creates a new TechwolfImageInfo instance using the specified properties.
     * @function create
     * @memberof TechwolfImageInfo
     * @static
     * @param {ITechwolfImageInfo=} [properties] Properties to set
     * @returns {TechwolfImageInfo} TechwolfImageInfo instance
     */
    TechwolfImageInfo.create = function create(properties) {
        return new TechwolfImageInfo(properties);
    };

    /**
     * Encodes the specified TechwolfImageInfo message. Does not implicitly {@link TechwolfImageInfo.verify|verify} messages.
     * @function encode
     * @memberof TechwolfImageInfo
     * @static
     * @param {ITechwolfImageInfo} message TechwolfImageInfo message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfImageInfo.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.url);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.width);
        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.height);
        return writer;
    };

    /**
     * Decodes a TechwolfImageInfo message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfImageInfo
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfImageInfo} TechwolfImageInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfImageInfo.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfImageInfo();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.url = reader.string();
                    break;
                }
            case 2: {
                    message.width = reader.int32();
                    break;
                }
            case 3: {
                    message.height = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("url"))
            throw $util.ProtocolError("missing required 'url'", { instance: message });
        if (!message.hasOwnProperty("width"))
            throw $util.ProtocolError("missing required 'width'", { instance: message });
        if (!message.hasOwnProperty("height"))
            throw $util.ProtocolError("missing required 'height'", { instance: message });
        return message;
    };

    return TechwolfImageInfo;
})();

export const TechwolfImage = $root.TechwolfImage = (() => {

    /**
     * Properties of a TechwolfImage.
     * @exports ITechwolfImage
     * @interface ITechwolfImage
     * @property {Long|null} [iid] TechwolfImage iid
     * @property {ITechwolfImageInfo|null} [tinyImage] TechwolfImage tinyImage
     * @property {ITechwolfImageInfo|null} [originImage] TechwolfImage originImage
     */

    /**
     * Constructs a new TechwolfImage.
     * @exports TechwolfImage
     * @classdesc Represents a TechwolfImage.
     * @implements ITechwolfImage
     * @constructor
     * @param {ITechwolfImage=} [properties] Properties to set
     */
    function TechwolfImage(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfImage iid.
     * @member {Long} iid
     * @memberof TechwolfImage
     * @instance
     */
    TechwolfImage.prototype.iid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfImage tinyImage.
     * @member {ITechwolfImageInfo|null|undefined} tinyImage
     * @memberof TechwolfImage
     * @instance
     */
    TechwolfImage.prototype.tinyImage = null;

    /**
     * TechwolfImage originImage.
     * @member {ITechwolfImageInfo|null|undefined} originImage
     * @memberof TechwolfImage
     * @instance
     */
    TechwolfImage.prototype.originImage = null;

    /**
     * Creates a new TechwolfImage instance using the specified properties.
     * @function create
     * @memberof TechwolfImage
     * @static
     * @param {ITechwolfImage=} [properties] Properties to set
     * @returns {TechwolfImage} TechwolfImage instance
     */
    TechwolfImage.create = function create(properties) {
        return new TechwolfImage(properties);
    };

    /**
     * Encodes the specified TechwolfImage message. Does not implicitly {@link TechwolfImage.verify|verify} messages.
     * @function encode
     * @memberof TechwolfImage
     * @static
     * @param {ITechwolfImage} message TechwolfImage message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfImage.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.iid != null && Object.hasOwnProperty.call(message, "iid"))
            writer.uint32(/* id 1, wireType 0 =*/8).int64(message.iid);
        if (message.tinyImage != null && Object.hasOwnProperty.call(message, "tinyImage"))
            $root.TechwolfImageInfo.encode(message.tinyImage, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        if (message.originImage != null && Object.hasOwnProperty.call(message, "originImage"))
            $root.TechwolfImageInfo.encode(message.originImage, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfImage message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfImage
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfImage} TechwolfImage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfImage.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfImage();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.iid = reader.int64();
                    break;
                }
            case 2: {
                    message.tinyImage = $root.TechwolfImageInfo.decode(reader, reader.uint32());
                    break;
                }
            case 3: {
                    message.originImage = $root.TechwolfImageInfo.decode(reader, reader.uint32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfImage;
})();

export const TechwolfAction = $root.TechwolfAction = (() => {

    /**
     * Properties of a TechwolfAction.
     * @exports ITechwolfAction
     * @interface ITechwolfAction
     * @property {number} aid TechwolfAction aid
     * @property {string|null} [extend] TechwolfAction extend
     */

    /**
     * Constructs a new TechwolfAction.
     * @exports TechwolfAction
     * @classdesc Represents a TechwolfAction.
     * @implements ITechwolfAction
     * @constructor
     * @param {ITechwolfAction=} [properties] Properties to set
     */
    function TechwolfAction(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfAction aid.
     * @member {number} aid
     * @memberof TechwolfAction
     * @instance
     */
    TechwolfAction.prototype.aid = 0;

    /**
     * TechwolfAction extend.
     * @member {string} extend
     * @memberof TechwolfAction
     * @instance
     */
    TechwolfAction.prototype.extend = "";

    /**
     * Creates a new TechwolfAction instance using the specified properties.
     * @function create
     * @memberof TechwolfAction
     * @static
     * @param {ITechwolfAction=} [properties] Properties to set
     * @returns {TechwolfAction} TechwolfAction instance
     */
    TechwolfAction.create = function create(properties) {
        return new TechwolfAction(properties);
    };

    /**
     * Encodes the specified TechwolfAction message. Does not implicitly {@link TechwolfAction.verify|verify} messages.
     * @function encode
     * @memberof TechwolfAction
     * @static
     * @param {ITechwolfAction} message TechwolfAction message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfAction.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.aid);
        if (message.extend != null && Object.hasOwnProperty.call(message, "extend"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.extend);
        return writer;
    };

    /**
     * Decodes a TechwolfAction message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfAction
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfAction} TechwolfAction
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfAction.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfAction();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.aid = reader.int32();
                    break;
                }
            case 2: {
                    message.extend = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("aid"))
            throw $util.ProtocolError("missing required 'aid'", { instance: message });
        return message;
    };

    return TechwolfAction;
})();

export const TechwolfArticle = $root.TechwolfArticle = (() => {

    /**
     * Properties of a TechwolfArticle.
     * @exports ITechwolfArticle
     * @interface ITechwolfArticle
     * @property {string} title TechwolfArticle title
     * @property {string} description TechwolfArticle description
     * @property {string} picUrl TechwolfArticle picUrl
     * @property {string} url TechwolfArticle url
     * @property {number|null} [templateId] TechwolfArticle templateId
     * @property {string|null} [bottomText] TechwolfArticle bottomText
     * @property {Long|null} [timeout] TechwolfArticle timeout
     * @property {string|null} [statisticParameters] TechwolfArticle statisticParameters
     * @property {Array.<ITechwolfSlice>|null} [highlightParts] TechwolfArticle highlightParts
     * @property {Array.<ITechwolfSlice>|null} [dimParts] TechwolfArticle dimParts
     * @property {string|null} [subTitle] TechwolfArticle subTitle
     * @property {string|null} [extend] TechwolfArticle extend
     */

    /**
     * Constructs a new TechwolfArticle.
     * @exports TechwolfArticle
     * @classdesc Represents a TechwolfArticle.
     * @implements ITechwolfArticle
     * @constructor
     * @param {ITechwolfArticle=} [properties] Properties to set
     */
    function TechwolfArticle(properties) {
        this.highlightParts = [];
        this.dimParts = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfArticle title.
     * @member {string} title
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.title = "";

    /**
     * TechwolfArticle description.
     * @member {string} description
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.description = "";

    /**
     * TechwolfArticle picUrl.
     * @member {string} picUrl
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.picUrl = "";

    /**
     * TechwolfArticle url.
     * @member {string} url
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.url = "";

    /**
     * TechwolfArticle templateId.
     * @member {number} templateId
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.templateId = 0;

    /**
     * TechwolfArticle bottomText.
     * @member {string} bottomText
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.bottomText = "";

    /**
     * TechwolfArticle timeout.
     * @member {Long} timeout
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.timeout = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfArticle statisticParameters.
     * @member {string} statisticParameters
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.statisticParameters = "";

    /**
     * TechwolfArticle highlightParts.
     * @member {Array.<ITechwolfSlice>} highlightParts
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.highlightParts = $util.emptyArray;

    /**
     * TechwolfArticle dimParts.
     * @member {Array.<ITechwolfSlice>} dimParts
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.dimParts = $util.emptyArray;

    /**
     * TechwolfArticle subTitle.
     * @member {string} subTitle
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.subTitle = "";

    /**
     * TechwolfArticle extend.
     * @member {string} extend
     * @memberof TechwolfArticle
     * @instance
     */
    TechwolfArticle.prototype.extend = "";

    /**
     * Creates a new TechwolfArticle instance using the specified properties.
     * @function create
     * @memberof TechwolfArticle
     * @static
     * @param {ITechwolfArticle=} [properties] Properties to set
     * @returns {TechwolfArticle} TechwolfArticle instance
     */
    TechwolfArticle.create = function create(properties) {
        return new TechwolfArticle(properties);
    };

    /**
     * Encodes the specified TechwolfArticle message. Does not implicitly {@link TechwolfArticle.verify|verify} messages.
     * @function encode
     * @memberof TechwolfArticle
     * @static
     * @param {ITechwolfArticle} message TechwolfArticle message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfArticle.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.description);
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.picUrl);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.url);
        if (message.templateId != null && Object.hasOwnProperty.call(message, "templateId"))
            writer.uint32(/* id 5, wireType 0 =*/40).int32(message.templateId);
        if (message.bottomText != null && Object.hasOwnProperty.call(message, "bottomText"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.bottomText);
        if (message.timeout != null && Object.hasOwnProperty.call(message, "timeout"))
            writer.uint32(/* id 7, wireType 0 =*/56).int64(message.timeout);
        if (message.statisticParameters != null && Object.hasOwnProperty.call(message, "statisticParameters"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.statisticParameters);
        if (message.highlightParts != null && message.highlightParts.length)
            for (let i = 0; i < message.highlightParts.length; ++i)
                $root.TechwolfSlice.encode(message.highlightParts[i], writer.uint32(/* id 9, wireType 2 =*/74).fork()).ldelim();
        if (message.dimParts != null && message.dimParts.length)
            for (let i = 0; i < message.dimParts.length; ++i)
                $root.TechwolfSlice.encode(message.dimParts[i], writer.uint32(/* id 10, wireType 2 =*/82).fork()).ldelim();
        if (message.subTitle != null && Object.hasOwnProperty.call(message, "subTitle"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.subTitle);
        if (message.extend != null && Object.hasOwnProperty.call(message, "extend"))
            writer.uint32(/* id 12, wireType 2 =*/98).string(message.extend);
        return writer;
    };

    /**
     * Decodes a TechwolfArticle message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfArticle
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfArticle} TechwolfArticle
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfArticle.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfArticle();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    message.description = reader.string();
                    break;
                }
            case 3: {
                    message.picUrl = reader.string();
                    break;
                }
            case 4: {
                    message.url = reader.string();
                    break;
                }
            case 5: {
                    message.templateId = reader.int32();
                    break;
                }
            case 6: {
                    message.bottomText = reader.string();
                    break;
                }
            case 7: {
                    message.timeout = reader.int64();
                    break;
                }
            case 8: {
                    message.statisticParameters = reader.string();
                    break;
                }
            case 9: {
                    if (!(message.highlightParts && message.highlightParts.length))
                        message.highlightParts = [];
                    message.highlightParts.push($root.TechwolfSlice.decode(reader, reader.uint32()));
                    break;
                }
            case 10: {
                    if (!(message.dimParts && message.dimParts.length))
                        message.dimParts = [];
                    message.dimParts.push($root.TechwolfSlice.decode(reader, reader.uint32()));
                    break;
                }
            case 11: {
                    message.subTitle = reader.string();
                    break;
                }
            case 12: {
                    message.extend = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("title"))
            throw $util.ProtocolError("missing required 'title'", { instance: message });
        if (!message.hasOwnProperty("description"))
            throw $util.ProtocolError("missing required 'description'", { instance: message });
        if (!message.hasOwnProperty("picUrl"))
            throw $util.ProtocolError("missing required 'picUrl'", { instance: message });
        if (!message.hasOwnProperty("url"))
            throw $util.ProtocolError("missing required 'url'", { instance: message });
        return message;
    };

    return TechwolfArticle;
})();

export const TechwolfNotify = $root.TechwolfNotify = (() => {

    /**
     * Properties of a TechwolfNotify.
     * @exports ITechwolfNotify
     * @interface ITechwolfNotify
     * @property {string} text TechwolfNotify text
     * @property {string|null} [url] TechwolfNotify url
     * @property {string|null} [title] TechwolfNotify title
     */

    /**
     * Constructs a new TechwolfNotify.
     * @exports TechwolfNotify
     * @classdesc Represents a TechwolfNotify.
     * @implements ITechwolfNotify
     * @constructor
     * @param {ITechwolfNotify=} [properties] Properties to set
     */
    function TechwolfNotify(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfNotify text.
     * @member {string} text
     * @memberof TechwolfNotify
     * @instance
     */
    TechwolfNotify.prototype.text = "";

    /**
     * TechwolfNotify url.
     * @member {string} url
     * @memberof TechwolfNotify
     * @instance
     */
    TechwolfNotify.prototype.url = "";

    /**
     * TechwolfNotify title.
     * @member {string} title
     * @memberof TechwolfNotify
     * @instance
     */
    TechwolfNotify.prototype.title = "";

    /**
     * Creates a new TechwolfNotify instance using the specified properties.
     * @function create
     * @memberof TechwolfNotify
     * @static
     * @param {ITechwolfNotify=} [properties] Properties to set
     * @returns {TechwolfNotify} TechwolfNotify instance
     */
    TechwolfNotify.create = function create(properties) {
        return new TechwolfNotify(properties);
    };

    /**
     * Encodes the specified TechwolfNotify message. Does not implicitly {@link TechwolfNotify.verify|verify} messages.
     * @function encode
     * @memberof TechwolfNotify
     * @static
     * @param {ITechwolfNotify} message TechwolfNotify message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfNotify.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
        if (message.title != null && Object.hasOwnProperty.call(message, "title"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.title);
        return writer;
    };

    /**
     * Decodes a TechwolfNotify message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfNotify
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfNotify} TechwolfNotify
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfNotify.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfNotify();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.text = reader.string();
                    break;
                }
            case 2: {
                    message.url = reader.string();
                    break;
                }
            case 3: {
                    message.title = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("text"))
            throw $util.ProtocolError("missing required 'text'", { instance: message });
        return message;
    };

    return TechwolfNotify;
})();

export const TechwolfButton = $root.TechwolfButton = (() => {

    /**
     * Properties of a TechwolfButton.
     * @exports ITechwolfButton
     * @interface ITechwolfButton
     * @property {string} text TechwolfButton text
     * @property {string|null} [url] TechwolfButton url
     * @property {number|null} [templateId] TechwolfButton templateId
     */

    /**
     * Constructs a new TechwolfButton.
     * @exports TechwolfButton
     * @classdesc Represents a TechwolfButton.
     * @implements ITechwolfButton
     * @constructor
     * @param {ITechwolfButton=} [properties] Properties to set
     */
    function TechwolfButton(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfButton text.
     * @member {string} text
     * @memberof TechwolfButton
     * @instance
     */
    TechwolfButton.prototype.text = "";

    /**
     * TechwolfButton url.
     * @member {string} url
     * @memberof TechwolfButton
     * @instance
     */
    TechwolfButton.prototype.url = "";

    /**
     * TechwolfButton templateId.
     * @member {number} templateId
     * @memberof TechwolfButton
     * @instance
     */
    TechwolfButton.prototype.templateId = 0;

    /**
     * Creates a new TechwolfButton instance using the specified properties.
     * @function create
     * @memberof TechwolfButton
     * @static
     * @param {ITechwolfButton=} [properties] Properties to set
     * @returns {TechwolfButton} TechwolfButton instance
     */
    TechwolfButton.create = function create(properties) {
        return new TechwolfButton(properties);
    };

    /**
     * Encodes the specified TechwolfButton message. Does not implicitly {@link TechwolfButton.verify|verify} messages.
     * @function encode
     * @memberof TechwolfButton
     * @static
     * @param {ITechwolfButton} message TechwolfButton message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfButton.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
        if (message.templateId != null && Object.hasOwnProperty.call(message, "templateId"))
            writer.uint32(/* id 3, wireType 0 =*/24).int32(message.templateId);
        return writer;
    };

    /**
     * Decodes a TechwolfButton message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfButton
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfButton} TechwolfButton
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfButton.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfButton();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.text = reader.string();
                    break;
                }
            case 2: {
                    message.url = reader.string();
                    break;
                }
            case 3: {
                    message.templateId = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("text"))
            throw $util.ProtocolError("missing required 'text'", { instance: message });
        return message;
    };

    return TechwolfButton;
})();

export const TechwolfDialog = $root.TechwolfDialog = (() => {

    /**
     * Properties of a TechwolfDialog.
     * @exports ITechwolfDialog
     * @interface ITechwolfDialog
     * @property {string} text TechwolfDialog text
     * @property {Array.<ITechwolfButton>|null} [buttons] TechwolfDialog buttons
     * @property {boolean} operated TechwolfDialog operated
     * @property {boolean|null} [clickMore] TechwolfDialog clickMore
     * @property {number|null} [type] TechwolfDialog type
     * @property {string|null} [backgroundUrl] TechwolfDialog backgroundUrl
     * @property {Long|null} [timeout] TechwolfDialog timeout
     * @property {string|null} [statisticParameters] TechwolfDialog statisticParameters
     * @property {string|null} [title] TechwolfDialog title
     * @property {string|null} [url] TechwolfDialog url
     * @property {number|null} [selectedIndex] TechwolfDialog selectedIndex
     * @property {string|null} [extend] TechwolfDialog extend
     * @property {string|null} [content] TechwolfDialog content
     */

    /**
     * Constructs a new TechwolfDialog.
     * @exports TechwolfDialog
     * @classdesc Represents a TechwolfDialog.
     * @implements ITechwolfDialog
     * @constructor
     * @param {ITechwolfDialog=} [properties] Properties to set
     */
    function TechwolfDialog(properties) {
        this.buttons = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfDialog text.
     * @member {string} text
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.text = "";

    /**
     * TechwolfDialog buttons.
     * @member {Array.<ITechwolfButton>} buttons
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.buttons = $util.emptyArray;

    /**
     * TechwolfDialog operated.
     * @member {boolean} operated
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.operated = false;

    /**
     * TechwolfDialog clickMore.
     * @member {boolean} clickMore
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.clickMore = false;

    /**
     * TechwolfDialog type.
     * @member {number} type
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.type = 0;

    /**
     * TechwolfDialog backgroundUrl.
     * @member {string} backgroundUrl
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.backgroundUrl = "";

    /**
     * TechwolfDialog timeout.
     * @member {Long} timeout
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.timeout = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfDialog statisticParameters.
     * @member {string} statisticParameters
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.statisticParameters = "";

    /**
     * TechwolfDialog title.
     * @member {string} title
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.title = "";

    /**
     * TechwolfDialog url.
     * @member {string} url
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.url = "";

    /**
     * TechwolfDialog selectedIndex.
     * @member {number} selectedIndex
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.selectedIndex = 0;

    /**
     * TechwolfDialog extend.
     * @member {string} extend
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.extend = "";

    /**
     * TechwolfDialog content.
     * @member {string} content
     * @memberof TechwolfDialog
     * @instance
     */
    TechwolfDialog.prototype.content = "";

    /**
     * Creates a new TechwolfDialog instance using the specified properties.
     * @function create
     * @memberof TechwolfDialog
     * @static
     * @param {ITechwolfDialog=} [properties] Properties to set
     * @returns {TechwolfDialog} TechwolfDialog instance
     */
    TechwolfDialog.create = function create(properties) {
        return new TechwolfDialog(properties);
    };

    /**
     * Encodes the specified TechwolfDialog message. Does not implicitly {@link TechwolfDialog.verify|verify} messages.
     * @function encode
     * @memberof TechwolfDialog
     * @static
     * @param {ITechwolfDialog} message TechwolfDialog message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfDialog.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
        if (message.buttons != null && message.buttons.length)
            for (let i = 0; i < message.buttons.length; ++i)
                $root.TechwolfButton.encode(message.buttons[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        writer.uint32(/* id 3, wireType 0 =*/24).bool(message.operated);
        if (message.clickMore != null && Object.hasOwnProperty.call(message, "clickMore"))
            writer.uint32(/* id 4, wireType 0 =*/32).bool(message.clickMore);
        if (message.type != null && Object.hasOwnProperty.call(message, "type"))
            writer.uint32(/* id 5, wireType 0 =*/40).int32(message.type);
        if (message.backgroundUrl != null && Object.hasOwnProperty.call(message, "backgroundUrl"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.backgroundUrl);
        if (message.timeout != null && Object.hasOwnProperty.call(message, "timeout"))
            writer.uint32(/* id 7, wireType 0 =*/56).int64(message.timeout);
        if (message.statisticParameters != null && Object.hasOwnProperty.call(message, "statisticParameters"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.statisticParameters);
        if (message.title != null && Object.hasOwnProperty.call(message, "title"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.title);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.url);
        if (message.selectedIndex != null && Object.hasOwnProperty.call(message, "selectedIndex"))
            writer.uint32(/* id 11, wireType 0 =*/88).int32(message.selectedIndex);
        if (message.extend != null && Object.hasOwnProperty.call(message, "extend"))
            writer.uint32(/* id 12, wireType 2 =*/98).string(message.extend);
        if (message.content != null && Object.hasOwnProperty.call(message, "content"))
            writer.uint32(/* id 13, wireType 2 =*/106).string(message.content);
        return writer;
    };

    /**
     * Decodes a TechwolfDialog message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfDialog
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfDialog} TechwolfDialog
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfDialog.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfDialog();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.text = reader.string();
                    break;
                }
            case 2: {
                    if (!(message.buttons && message.buttons.length))
                        message.buttons = [];
                    message.buttons.push($root.TechwolfButton.decode(reader, reader.uint32()));
                    break;
                }
            case 3: {
                    message.operated = reader.bool();
                    break;
                }
            case 4: {
                    message.clickMore = reader.bool();
                    break;
                }
            case 5: {
                    message.type = reader.int32();
                    break;
                }
            case 6: {
                    message.backgroundUrl = reader.string();
                    break;
                }
            case 7: {
                    message.timeout = reader.int64();
                    break;
                }
            case 8: {
                    message.statisticParameters = reader.string();
                    break;
                }
            case 9: {
                    message.title = reader.string();
                    break;
                }
            case 10: {
                    message.url = reader.string();
                    break;
                }
            case 11: {
                    message.selectedIndex = reader.int32();
                    break;
                }
            case 12: {
                    message.extend = reader.string();
                    break;
                }
            case 13: {
                    message.content = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("text"))
            throw $util.ProtocolError("missing required 'text'", { instance: message });
        if (!message.hasOwnProperty("operated"))
            throw $util.ProtocolError("missing required 'operated'", { instance: message });
        return message;
    };

    return TechwolfDialog;
})();

export const TechwolfJobDesc = $root.TechwolfJobDesc = (() => {

    /**
     * Properties of a TechwolfJobDesc.
     * @exports ITechwolfJobDesc
     * @interface ITechwolfJobDesc
     * @property {string} title TechwolfJobDesc title
     * @property {string} company TechwolfJobDesc company
     * @property {string} salary TechwolfJobDesc salary
     * @property {string} url TechwolfJobDesc url
     * @property {Long} jobId TechwolfJobDesc jobId
     * @property {string|null} [positionCategory] TechwolfJobDesc positionCategory
     * @property {string|null} [experience] TechwolfJobDesc experience
     * @property {string|null} [education] TechwolfJobDesc education
     * @property {string|null} [city] TechwolfJobDesc city
     * @property {string|null} [bossTitle] TechwolfJobDesc bossTitle
     * @property {ITechwolfUser|null} [boss] TechwolfJobDesc boss
     * @property {string|null} [lid] TechwolfJobDesc lid
     * @property {string|null} [stage] TechwolfJobDesc stage
     * @property {string|null} [bottomText] TechwolfJobDesc bottomText
     * @property {string|null} [jobLabel] TechwolfJobDesc jobLabel
     * @property {number|null} [iconFlag] TechwolfJobDesc iconFlag
     * @property {string|null} [content] TechwolfJobDesc content
     * @property {Array.<string>|null} [labels] TechwolfJobDesc labels
     * @property {Long|null} [expectId] TechwolfJobDesc expectId
     * @property {string|null} [expectPosition] TechwolfJobDesc expectPosition
     * @property {string|null} [expectSalary] TechwolfJobDesc expectSalary
     * @property {string|null} [partTimeDesc] TechwolfJobDesc partTimeDesc
     * @property {ITechwolfUser|null} [geek] TechwolfJobDesc geek
     * @property {string|null} [latlon] TechwolfJobDesc latlon
     * @property {string|null} [distance] TechwolfJobDesc distance
     */

    /**
     * Constructs a new TechwolfJobDesc.
     * @exports TechwolfJobDesc
     * @classdesc Represents a TechwolfJobDesc.
     * @implements ITechwolfJobDesc
     * @constructor
     * @param {ITechwolfJobDesc=} [properties] Properties to set
     */
    function TechwolfJobDesc(properties) {
        this.labels = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfJobDesc title.
     * @member {string} title
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.title = "";

    /**
     * TechwolfJobDesc company.
     * @member {string} company
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.company = "";

    /**
     * TechwolfJobDesc salary.
     * @member {string} salary
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.salary = "";

    /**
     * TechwolfJobDesc url.
     * @member {string} url
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.url = "";

    /**
     * TechwolfJobDesc jobId.
     * @member {Long} jobId
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.jobId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfJobDesc positionCategory.
     * @member {string} positionCategory
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.positionCategory = "";

    /**
     * TechwolfJobDesc experience.
     * @member {string} experience
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.experience = "";

    /**
     * TechwolfJobDesc education.
     * @member {string} education
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.education = "";

    /**
     * TechwolfJobDesc city.
     * @member {string} city
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.city = "";

    /**
     * TechwolfJobDesc bossTitle.
     * @member {string} bossTitle
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.bossTitle = "";

    /**
     * TechwolfJobDesc boss.
     * @member {ITechwolfUser|null|undefined} boss
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.boss = null;

    /**
     * TechwolfJobDesc lid.
     * @member {string} lid
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.lid = "";

    /**
     * TechwolfJobDesc stage.
     * @member {string} stage
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.stage = "";

    /**
     * TechwolfJobDesc bottomText.
     * @member {string} bottomText
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.bottomText = "";

    /**
     * TechwolfJobDesc jobLabel.
     * @member {string} jobLabel
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.jobLabel = "";

    /**
     * TechwolfJobDesc iconFlag.
     * @member {number} iconFlag
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.iconFlag = 0;

    /**
     * TechwolfJobDesc content.
     * @member {string} content
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.content = "";

    /**
     * TechwolfJobDesc labels.
     * @member {Array.<string>} labels
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.labels = $util.emptyArray;

    /**
     * TechwolfJobDesc expectId.
     * @member {Long} expectId
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.expectId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfJobDesc expectPosition.
     * @member {string} expectPosition
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.expectPosition = "";

    /**
     * TechwolfJobDesc expectSalary.
     * @member {string} expectSalary
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.expectSalary = "";

    /**
     * TechwolfJobDesc partTimeDesc.
     * @member {string} partTimeDesc
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.partTimeDesc = "";

    /**
     * TechwolfJobDesc geek.
     * @member {ITechwolfUser|null|undefined} geek
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.geek = null;

    /**
     * TechwolfJobDesc latlon.
     * @member {string} latlon
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.latlon = "";

    /**
     * TechwolfJobDesc distance.
     * @member {string} distance
     * @memberof TechwolfJobDesc
     * @instance
     */
    TechwolfJobDesc.prototype.distance = "";

    /**
     * Creates a new TechwolfJobDesc instance using the specified properties.
     * @function create
     * @memberof TechwolfJobDesc
     * @static
     * @param {ITechwolfJobDesc=} [properties] Properties to set
     * @returns {TechwolfJobDesc} TechwolfJobDesc instance
     */
    TechwolfJobDesc.create = function create(properties) {
        return new TechwolfJobDesc(properties);
    };

    /**
     * Encodes the specified TechwolfJobDesc message. Does not implicitly {@link TechwolfJobDesc.verify|verify} messages.
     * @function encode
     * @memberof TechwolfJobDesc
     * @static
     * @param {ITechwolfJobDesc} message TechwolfJobDesc message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfJobDesc.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.company);
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.salary);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.url);
        writer.uint32(/* id 5, wireType 0 =*/40).int64(message.jobId);
        if (message.positionCategory != null && Object.hasOwnProperty.call(message, "positionCategory"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.positionCategory);
        if (message.experience != null && Object.hasOwnProperty.call(message, "experience"))
            writer.uint32(/* id 7, wireType 2 =*/58).string(message.experience);
        if (message.education != null && Object.hasOwnProperty.call(message, "education"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.education);
        if (message.city != null && Object.hasOwnProperty.call(message, "city"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.city);
        if (message.bossTitle != null && Object.hasOwnProperty.call(message, "bossTitle"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.bossTitle);
        if (message.boss != null && Object.hasOwnProperty.call(message, "boss"))
            $root.TechwolfUser.encode(message.boss, writer.uint32(/* id 11, wireType 2 =*/90).fork()).ldelim();
        if (message.lid != null && Object.hasOwnProperty.call(message, "lid"))
            writer.uint32(/* id 12, wireType 2 =*/98).string(message.lid);
        if (message.stage != null && Object.hasOwnProperty.call(message, "stage"))
            writer.uint32(/* id 13, wireType 2 =*/106).string(message.stage);
        if (message.bottomText != null && Object.hasOwnProperty.call(message, "bottomText"))
            writer.uint32(/* id 14, wireType 2 =*/114).string(message.bottomText);
        if (message.jobLabel != null && Object.hasOwnProperty.call(message, "jobLabel"))
            writer.uint32(/* id 15, wireType 2 =*/122).string(message.jobLabel);
        if (message.iconFlag != null && Object.hasOwnProperty.call(message, "iconFlag"))
            writer.uint32(/* id 16, wireType 0 =*/128).int32(message.iconFlag);
        if (message.content != null && Object.hasOwnProperty.call(message, "content"))
            writer.uint32(/* id 17, wireType 2 =*/138).string(message.content);
        if (message.labels != null && message.labels.length)
            for (let i = 0; i < message.labels.length; ++i)
                writer.uint32(/* id 18, wireType 2 =*/146).string(message.labels[i]);
        if (message.expectId != null && Object.hasOwnProperty.call(message, "expectId"))
            writer.uint32(/* id 19, wireType 0 =*/152).int64(message.expectId);
        if (message.expectPosition != null && Object.hasOwnProperty.call(message, "expectPosition"))
            writer.uint32(/* id 20, wireType 2 =*/162).string(message.expectPosition);
        if (message.expectSalary != null && Object.hasOwnProperty.call(message, "expectSalary"))
            writer.uint32(/* id 21, wireType 2 =*/170).string(message.expectSalary);
        if (message.partTimeDesc != null && Object.hasOwnProperty.call(message, "partTimeDesc"))
            writer.uint32(/* id 22, wireType 2 =*/178).string(message.partTimeDesc);
        if (message.geek != null && Object.hasOwnProperty.call(message, "geek"))
            $root.TechwolfUser.encode(message.geek, writer.uint32(/* id 23, wireType 2 =*/186).fork()).ldelim();
        if (message.latlon != null && Object.hasOwnProperty.call(message, "latlon"))
            writer.uint32(/* id 24, wireType 2 =*/194).string(message.latlon);
        if (message.distance != null && Object.hasOwnProperty.call(message, "distance"))
            writer.uint32(/* id 25, wireType 2 =*/202).string(message.distance);
        return writer;
    };

    /**
     * Decodes a TechwolfJobDesc message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfJobDesc
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfJobDesc} TechwolfJobDesc
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfJobDesc.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfJobDesc();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    message.company = reader.string();
                    break;
                }
            case 3: {
                    message.salary = reader.string();
                    break;
                }
            case 4: {
                    message.url = reader.string();
                    break;
                }
            case 5: {
                    message.jobId = reader.int64();
                    break;
                }
            case 6: {
                    message.positionCategory = reader.string();
                    break;
                }
            case 7: {
                    message.experience = reader.string();
                    break;
                }
            case 8: {
                    message.education = reader.string();
                    break;
                }
            case 9: {
                    message.city = reader.string();
                    break;
                }
            case 10: {
                    message.bossTitle = reader.string();
                    break;
                }
            case 11: {
                    message.boss = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 12: {
                    message.lid = reader.string();
                    break;
                }
            case 13: {
                    message.stage = reader.string();
                    break;
                }
            case 14: {
                    message.bottomText = reader.string();
                    break;
                }
            case 15: {
                    message.jobLabel = reader.string();
                    break;
                }
            case 16: {
                    message.iconFlag = reader.int32();
                    break;
                }
            case 17: {
                    message.content = reader.string();
                    break;
                }
            case 18: {
                    if (!(message.labels && message.labels.length))
                        message.labels = [];
                    message.labels.push(reader.string());
                    break;
                }
            case 19: {
                    message.expectId = reader.int64();
                    break;
                }
            case 20: {
                    message.expectPosition = reader.string();
                    break;
                }
            case 21: {
                    message.expectSalary = reader.string();
                    break;
                }
            case 22: {
                    message.partTimeDesc = reader.string();
                    break;
                }
            case 23: {
                    message.geek = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 24: {
                    message.latlon = reader.string();
                    break;
                }
            case 25: {
                    message.distance = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("title"))
            throw $util.ProtocolError("missing required 'title'", { instance: message });
        if (!message.hasOwnProperty("company"))
            throw $util.ProtocolError("missing required 'company'", { instance: message });
        if (!message.hasOwnProperty("salary"))
            throw $util.ProtocolError("missing required 'salary'", { instance: message });
        if (!message.hasOwnProperty("url"))
            throw $util.ProtocolError("missing required 'url'", { instance: message });
        if (!message.hasOwnProperty("jobId"))
            throw $util.ProtocolError("missing required 'jobId'", { instance: message });
        return message;
    };

    return TechwolfJobDesc;
})();

export const TechwolfResume = $root.TechwolfResume = (() => {

    /**
     * Properties of a TechwolfResume.
     * @exports ITechwolfResume
     * @interface ITechwolfResume
     * @property {ITechwolfUser} user TechwolfResume user
     * @property {string|null} [description] TechwolfResume description
     * @property {string|null} [city] TechwolfResume city
     * @property {string|null} [position] TechwolfResume position
     * @property {Array.<string>|null} [keywords] TechwolfResume keywords
     * @property {Long|null} [expectId] TechwolfResume expectId
     * @property {string|null} [lid] TechwolfResume lid
     * @property {number|null} [gender] TechwolfResume gender
     * @property {string|null} [salary] TechwolfResume salary
     * @property {string|null} [workYear] TechwolfResume workYear
     * @property {string|null} [content1] TechwolfResume content1
     * @property {string|null} [content2] TechwolfResume content2
     * @property {string|null} [education] TechwolfResume education
     * @property {string|null} [age] TechwolfResume age
     * @property {Array.<string>|null} [labels] TechwolfResume labels
     * @property {Array.<IUserExperience>|null} [experiences] TechwolfResume experiences
     * @property {string|null} [positionCategory] TechwolfResume positionCategory
     * @property {string|null} [jobSalary] TechwolfResume jobSalary
     * @property {string|null} [bottomText] TechwolfResume bottomText
     * @property {string|null} [applyStatus] TechwolfResume applyStatus
     * @property {Long|null} [jobId] TechwolfResume jobId
     * @property {string|null} [content3] TechwolfResume content3
     * @property {string|null} [securityId] TechwolfResume securityId
     * @property {ITechwolfUser|null} [boss] TechwolfResume boss
     * @property {string|null} [brandName] TechwolfResume brandName
     */

    /**
     * Constructs a new TechwolfResume.
     * @exports TechwolfResume
     * @classdesc Represents a TechwolfResume.
     * @implements ITechwolfResume
     * @constructor
     * @param {ITechwolfResume=} [properties] Properties to set
     */
    function TechwolfResume(properties) {
        this.keywords = [];
        this.labels = [];
        this.experiences = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfResume user.
     * @member {ITechwolfUser} user
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.user = null;

    /**
     * TechwolfResume description.
     * @member {string} description
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.description = "";

    /**
     * TechwolfResume city.
     * @member {string} city
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.city = "";

    /**
     * TechwolfResume position.
     * @member {string} position
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.position = "";

    /**
     * TechwolfResume keywords.
     * @member {Array.<string>} keywords
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.keywords = $util.emptyArray;

    /**
     * TechwolfResume expectId.
     * @member {Long} expectId
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.expectId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfResume lid.
     * @member {string} lid
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.lid = "";

    /**
     * TechwolfResume gender.
     * @member {number} gender
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.gender = 0;

    /**
     * TechwolfResume salary.
     * @member {string} salary
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.salary = "";

    /**
     * TechwolfResume workYear.
     * @member {string} workYear
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.workYear = "";

    /**
     * TechwolfResume content1.
     * @member {string} content1
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.content1 = "";

    /**
     * TechwolfResume content2.
     * @member {string} content2
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.content2 = "";

    /**
     * TechwolfResume education.
     * @member {string} education
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.education = "";

    /**
     * TechwolfResume age.
     * @member {string} age
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.age = "";

    /**
     * TechwolfResume labels.
     * @member {Array.<string>} labels
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.labels = $util.emptyArray;

    /**
     * TechwolfResume experiences.
     * @member {Array.<IUserExperience>} experiences
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.experiences = $util.emptyArray;

    /**
     * TechwolfResume positionCategory.
     * @member {string} positionCategory
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.positionCategory = "";

    /**
     * TechwolfResume jobSalary.
     * @member {string} jobSalary
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.jobSalary = "";

    /**
     * TechwolfResume bottomText.
     * @member {string} bottomText
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.bottomText = "";

    /**
     * TechwolfResume applyStatus.
     * @member {string} applyStatus
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.applyStatus = "";

    /**
     * TechwolfResume jobId.
     * @member {Long} jobId
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.jobId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfResume content3.
     * @member {string} content3
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.content3 = "";

    /**
     * TechwolfResume securityId.
     * @member {string} securityId
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.securityId = "";

    /**
     * TechwolfResume boss.
     * @member {ITechwolfUser|null|undefined} boss
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.boss = null;

    /**
     * TechwolfResume brandName.
     * @member {string} brandName
     * @memberof TechwolfResume
     * @instance
     */
    TechwolfResume.prototype.brandName = "";

    /**
     * Creates a new TechwolfResume instance using the specified properties.
     * @function create
     * @memberof TechwolfResume
     * @static
     * @param {ITechwolfResume=} [properties] Properties to set
     * @returns {TechwolfResume} TechwolfResume instance
     */
    TechwolfResume.create = function create(properties) {
        return new TechwolfResume(properties);
    };

    /**
     * Encodes the specified TechwolfResume message. Does not implicitly {@link TechwolfResume.verify|verify} messages.
     * @function encode
     * @memberof TechwolfResume
     * @static
     * @param {ITechwolfResume} message TechwolfResume message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfResume.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        $root.TechwolfUser.encode(message.user, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        if (message.description != null && Object.hasOwnProperty.call(message, "description"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.description);
        if (message.city != null && Object.hasOwnProperty.call(message, "city"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.city);
        if (message.position != null && Object.hasOwnProperty.call(message, "position"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.position);
        if (message.keywords != null && message.keywords.length)
            for (let i = 0; i < message.keywords.length; ++i)
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.keywords[i]);
        if (message.expectId != null && Object.hasOwnProperty.call(message, "expectId"))
            writer.uint32(/* id 6, wireType 0 =*/48).int64(message.expectId);
        if (message.lid != null && Object.hasOwnProperty.call(message, "lid"))
            writer.uint32(/* id 7, wireType 2 =*/58).string(message.lid);
        if (message.gender != null && Object.hasOwnProperty.call(message, "gender"))
            writer.uint32(/* id 8, wireType 0 =*/64).int32(message.gender);
        if (message.salary != null && Object.hasOwnProperty.call(message, "salary"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.salary);
        if (message.workYear != null && Object.hasOwnProperty.call(message, "workYear"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.workYear);
        if (message.content1 != null && Object.hasOwnProperty.call(message, "content1"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.content1);
        if (message.content2 != null && Object.hasOwnProperty.call(message, "content2"))
            writer.uint32(/* id 12, wireType 2 =*/98).string(message.content2);
        if (message.education != null && Object.hasOwnProperty.call(message, "education"))
            writer.uint32(/* id 13, wireType 2 =*/106).string(message.education);
        if (message.age != null && Object.hasOwnProperty.call(message, "age"))
            writer.uint32(/* id 14, wireType 2 =*/114).string(message.age);
        if (message.labels != null && message.labels.length)
            for (let i = 0; i < message.labels.length; ++i)
                writer.uint32(/* id 15, wireType 2 =*/122).string(message.labels[i]);
        if (message.experiences != null && message.experiences.length)
            for (let i = 0; i < message.experiences.length; ++i)
                $root.UserExperience.encode(message.experiences[i], writer.uint32(/* id 16, wireType 2 =*/130).fork()).ldelim();
        if (message.positionCategory != null && Object.hasOwnProperty.call(message, "positionCategory"))
            writer.uint32(/* id 17, wireType 2 =*/138).string(message.positionCategory);
        if (message.jobSalary != null && Object.hasOwnProperty.call(message, "jobSalary"))
            writer.uint32(/* id 18, wireType 2 =*/146).string(message.jobSalary);
        if (message.bottomText != null && Object.hasOwnProperty.call(message, "bottomText"))
            writer.uint32(/* id 19, wireType 2 =*/154).string(message.bottomText);
        if (message.applyStatus != null && Object.hasOwnProperty.call(message, "applyStatus"))
            writer.uint32(/* id 20, wireType 2 =*/162).string(message.applyStatus);
        if (message.jobId != null && Object.hasOwnProperty.call(message, "jobId"))
            writer.uint32(/* id 21, wireType 0 =*/168).int64(message.jobId);
        if (message.content3 != null && Object.hasOwnProperty.call(message, "content3"))
            writer.uint32(/* id 22, wireType 2 =*/178).string(message.content3);
        if (message.securityId != null && Object.hasOwnProperty.call(message, "securityId"))
            writer.uint32(/* id 23, wireType 2 =*/186).string(message.securityId);
        if (message.boss != null && Object.hasOwnProperty.call(message, "boss"))
            $root.TechwolfUser.encode(message.boss, writer.uint32(/* id 24, wireType 2 =*/194).fork()).ldelim();
        if (message.brandName != null && Object.hasOwnProperty.call(message, "brandName"))
            writer.uint32(/* id 25, wireType 2 =*/202).string(message.brandName);
        return writer;
    };

    /**
     * Decodes a TechwolfResume message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfResume
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfResume} TechwolfResume
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfResume.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfResume();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.user = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 2: {
                    message.description = reader.string();
                    break;
                }
            case 3: {
                    message.city = reader.string();
                    break;
                }
            case 4: {
                    message.position = reader.string();
                    break;
                }
            case 5: {
                    if (!(message.keywords && message.keywords.length))
                        message.keywords = [];
                    message.keywords.push(reader.string());
                    break;
                }
            case 6: {
                    message.expectId = reader.int64();
                    break;
                }
            case 7: {
                    message.lid = reader.string();
                    break;
                }
            case 8: {
                    message.gender = reader.int32();
                    break;
                }
            case 9: {
                    message.salary = reader.string();
                    break;
                }
            case 10: {
                    message.workYear = reader.string();
                    break;
                }
            case 11: {
                    message.content1 = reader.string();
                    break;
                }
            case 12: {
                    message.content2 = reader.string();
                    break;
                }
            case 13: {
                    message.education = reader.string();
                    break;
                }
            case 14: {
                    message.age = reader.string();
                    break;
                }
            case 15: {
                    if (!(message.labels && message.labels.length))
                        message.labels = [];
                    message.labels.push(reader.string());
                    break;
                }
            case 16: {
                    if (!(message.experiences && message.experiences.length))
                        message.experiences = [];
                    message.experiences.push($root.UserExperience.decode(reader, reader.uint32()));
                    break;
                }
            case 17: {
                    message.positionCategory = reader.string();
                    break;
                }
            case 18: {
                    message.jobSalary = reader.string();
                    break;
                }
            case 19: {
                    message.bottomText = reader.string();
                    break;
                }
            case 20: {
                    message.applyStatus = reader.string();
                    break;
                }
            case 21: {
                    message.jobId = reader.int64();
                    break;
                }
            case 22: {
                    message.content3 = reader.string();
                    break;
                }
            case 23: {
                    message.securityId = reader.string();
                    break;
                }
            case 24: {
                    message.boss = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 25: {
                    message.brandName = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("user"))
            throw $util.ProtocolError("missing required 'user'", { instance: message });
        return message;
    };

    return TechwolfResume;
})();

export const TechwolfHyperLink = $root.TechwolfHyperLink = (() => {

    /**
     * Properties of a TechwolfHyperLink.
     * @exports ITechwolfHyperLink
     * @interface ITechwolfHyperLink
     * @property {string} text TechwolfHyperLink text
     * @property {string} url TechwolfHyperLink url
     * @property {number} hyperLinkType TechwolfHyperLink hyperLinkType
     * @property {string|null} [extraJson] TechwolfHyperLink extraJson
     */

    /**
     * Constructs a new TechwolfHyperLink.
     * @exports TechwolfHyperLink
     * @classdesc Represents a TechwolfHyperLink.
     * @implements ITechwolfHyperLink
     * @constructor
     * @param {ITechwolfHyperLink=} [properties] Properties to set
     */
    function TechwolfHyperLink(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfHyperLink text.
     * @member {string} text
     * @memberof TechwolfHyperLink
     * @instance
     */
    TechwolfHyperLink.prototype.text = "";

    /**
     * TechwolfHyperLink url.
     * @member {string} url
     * @memberof TechwolfHyperLink
     * @instance
     */
    TechwolfHyperLink.prototype.url = "";

    /**
     * TechwolfHyperLink hyperLinkType.
     * @member {number} hyperLinkType
     * @memberof TechwolfHyperLink
     * @instance
     */
    TechwolfHyperLink.prototype.hyperLinkType = 0;

    /**
     * TechwolfHyperLink extraJson.
     * @member {string} extraJson
     * @memberof TechwolfHyperLink
     * @instance
     */
    TechwolfHyperLink.prototype.extraJson = "";

    /**
     * Creates a new TechwolfHyperLink instance using the specified properties.
     * @function create
     * @memberof TechwolfHyperLink
     * @static
     * @param {ITechwolfHyperLink=} [properties] Properties to set
     * @returns {TechwolfHyperLink} TechwolfHyperLink instance
     */
    TechwolfHyperLink.create = function create(properties) {
        return new TechwolfHyperLink(properties);
    };

    /**
     * Encodes the specified TechwolfHyperLink message. Does not implicitly {@link TechwolfHyperLink.verify|verify} messages.
     * @function encode
     * @memberof TechwolfHyperLink
     * @static
     * @param {ITechwolfHyperLink} message TechwolfHyperLink message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfHyperLink.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.url);
        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.hyperLinkType);
        if (message.extraJson != null && Object.hasOwnProperty.call(message, "extraJson"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.extraJson);
        return writer;
    };

    /**
     * Decodes a TechwolfHyperLink message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfHyperLink
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfHyperLink} TechwolfHyperLink
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfHyperLink.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfHyperLink();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.text = reader.string();
                    break;
                }
            case 2: {
                    message.url = reader.string();
                    break;
                }
            case 3: {
                    message.hyperLinkType = reader.int32();
                    break;
                }
            case 4: {
                    message.extraJson = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("text"))
            throw $util.ProtocolError("missing required 'text'", { instance: message });
        if (!message.hasOwnProperty("url"))
            throw $util.ProtocolError("missing required 'url'", { instance: message });
        if (!message.hasOwnProperty("hyperLinkType"))
            throw $util.ProtocolError("missing required 'hyperLinkType'", { instance: message });
        return message;
    };

    return TechwolfHyperLink;
})();

export const TechwolfMessageBody = $root.TechwolfMessageBody = (() => {

    /**
     * Properties of a TechwolfMessageBody.
     * @exports ITechwolfMessageBody
     * @interface ITechwolfMessageBody
     * @property {number} type TechwolfMessageBody type
     * @property {number} templateId TechwolfMessageBody templateId
     * @property {string|null} [headTitle] TechwolfMessageBody headTitle
     * @property {string|null} [text] TechwolfMessageBody text
     * @property {ITechwolfSound|null} [sound] TechwolfMessageBody sound
     * @property {ITechwolfImage|null} [image] TechwolfMessageBody image
     * @property {ITechwolfAction|null} [action] TechwolfMessageBody action
     * @property {Array.<ITechwolfArticle>|null} [articles] TechwolfMessageBody articles
     * @property {ITechwolfNotify|null} [notify] TechwolfMessageBody notify
     * @property {ITechwolfDialog|null} [dialog] TechwolfMessageBody dialog
     * @property {ITechwolfJobDesc|null} [jobDesc] TechwolfMessageBody jobDesc
     * @property {ITechwolfResume|null} [resume] TechwolfMessageBody resume
     * @property {ITechwolfRedEnvelope|null} [redEnvelope] TechwolfMessageBody redEnvelope
     * @property {ITechwolfOrderDetail|null} [orderDetail] TechwolfMessageBody orderDetail
     * @property {ITechwolfHyperLink|null} [hyperLink] TechwolfMessageBody hyperLink
     * @property {ITechwolfVideo|null} [video] TechwolfMessageBody video
     * @property {ITechwolfInterview|null} [interview] TechwolfMessageBody interview
     * @property {ITechwolfJobShare|null} [jobShare] TechwolfMessageBody jobShare
     * @property {ITechwolfResumeShare|null} [resumeShare] TechwolfMessageBody resumeShare
     * @property {IAtInfo|null} [atInfo] TechwolfMessageBody atInfo
     * @property {ITechwolfSticker|null} [sticker] TechwolfMessageBody sticker
     * @property {ITechwolfChatShare|null} [chatShare] TechwolfMessageBody chatShare
     * @property {ITechwolfInterviewShare|null} [interviewShare] TechwolfMessageBody interviewShare
     * @property {ITechwolfListCard|null} [listCard] TechwolfMessageBody listCard
     * @property {ITechwolfStarRate|null} [starRate] TechwolfMessageBody starRate
     * @property {ITechwolfFrame|null} [frame] TechwolfMessageBody frame
     * @property {ITechwolfMultiImage|null} [multiImage] TechwolfMessageBody multiImage
     * @property {string|null} [extend] TechwolfMessageBody extend
     */

    /**
     * Constructs a new TechwolfMessageBody.
     * @exports TechwolfMessageBody
     * @classdesc Represents a TechwolfMessageBody.
     * @implements ITechwolfMessageBody
     * @constructor
     * @param {ITechwolfMessageBody=} [properties] Properties to set
     */
    function TechwolfMessageBody(properties) {
        this.articles = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfMessageBody type.
     * @member {number} type
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.type = 0;

    /**
     * TechwolfMessageBody templateId.
     * @member {number} templateId
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.templateId = 0;

    /**
     * TechwolfMessageBody headTitle.
     * @member {string} headTitle
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.headTitle = "";

    /**
     * TechwolfMessageBody text.
     * @member {string} text
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.text = "";

    /**
     * TechwolfMessageBody sound.
     * @member {ITechwolfSound|null|undefined} sound
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.sound = null;

    /**
     * TechwolfMessageBody image.
     * @member {ITechwolfImage|null|undefined} image
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.image = null;

    /**
     * TechwolfMessageBody action.
     * @member {ITechwolfAction|null|undefined} action
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.action = null;

    /**
     * TechwolfMessageBody articles.
     * @member {Array.<ITechwolfArticle>} articles
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.articles = $util.emptyArray;

    /**
     * TechwolfMessageBody notify.
     * @member {ITechwolfNotify|null|undefined} notify
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.notify = null;

    /**
     * TechwolfMessageBody dialog.
     * @member {ITechwolfDialog|null|undefined} dialog
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.dialog = null;

    /**
     * TechwolfMessageBody jobDesc.
     * @member {ITechwolfJobDesc|null|undefined} jobDesc
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.jobDesc = null;

    /**
     * TechwolfMessageBody resume.
     * @member {ITechwolfResume|null|undefined} resume
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.resume = null;

    /**
     * TechwolfMessageBody redEnvelope.
     * @member {ITechwolfRedEnvelope|null|undefined} redEnvelope
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.redEnvelope = null;

    /**
     * TechwolfMessageBody orderDetail.
     * @member {ITechwolfOrderDetail|null|undefined} orderDetail
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.orderDetail = null;

    /**
     * TechwolfMessageBody hyperLink.
     * @member {ITechwolfHyperLink|null|undefined} hyperLink
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.hyperLink = null;

    /**
     * TechwolfMessageBody video.
     * @member {ITechwolfVideo|null|undefined} video
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.video = null;

    /**
     * TechwolfMessageBody interview.
     * @member {ITechwolfInterview|null|undefined} interview
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.interview = null;

    /**
     * TechwolfMessageBody jobShare.
     * @member {ITechwolfJobShare|null|undefined} jobShare
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.jobShare = null;

    /**
     * TechwolfMessageBody resumeShare.
     * @member {ITechwolfResumeShare|null|undefined} resumeShare
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.resumeShare = null;

    /**
     * TechwolfMessageBody atInfo.
     * @member {IAtInfo|null|undefined} atInfo
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.atInfo = null;

    /**
     * TechwolfMessageBody sticker.
     * @member {ITechwolfSticker|null|undefined} sticker
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.sticker = null;

    /**
     * TechwolfMessageBody chatShare.
     * @member {ITechwolfChatShare|null|undefined} chatShare
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.chatShare = null;

    /**
     * TechwolfMessageBody interviewShare.
     * @member {ITechwolfInterviewShare|null|undefined} interviewShare
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.interviewShare = null;

    /**
     * TechwolfMessageBody listCard.
     * @member {ITechwolfListCard|null|undefined} listCard
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.listCard = null;

    /**
     * TechwolfMessageBody starRate.
     * @member {ITechwolfStarRate|null|undefined} starRate
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.starRate = null;

    /**
     * TechwolfMessageBody frame.
     * @member {ITechwolfFrame|null|undefined} frame
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.frame = null;

    /**
     * TechwolfMessageBody multiImage.
     * @member {ITechwolfMultiImage|null|undefined} multiImage
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.multiImage = null;

    /**
     * TechwolfMessageBody extend.
     * @member {string} extend
     * @memberof TechwolfMessageBody
     * @instance
     */
    TechwolfMessageBody.prototype.extend = "";

    /**
     * Creates a new TechwolfMessageBody instance using the specified properties.
     * @function create
     * @memberof TechwolfMessageBody
     * @static
     * @param {ITechwolfMessageBody=} [properties] Properties to set
     * @returns {TechwolfMessageBody} TechwolfMessageBody instance
     */
    TechwolfMessageBody.create = function create(properties) {
        return new TechwolfMessageBody(properties);
    };

    /**
     * Encodes the specified TechwolfMessageBody message. Does not implicitly {@link TechwolfMessageBody.verify|verify} messages.
     * @function encode
     * @memberof TechwolfMessageBody
     * @static
     * @param {ITechwolfMessageBody} message TechwolfMessageBody message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfMessageBody.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.templateId);
        if (message.text != null && Object.hasOwnProperty.call(message, "text"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.text);
        if (message.sound != null && Object.hasOwnProperty.call(message, "sound"))
            $root.TechwolfSound.encode(message.sound, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
        if (message.image != null && Object.hasOwnProperty.call(message, "image"))
            $root.TechwolfImage.encode(message.image, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
        if (message.action != null && Object.hasOwnProperty.call(message, "action"))
            $root.TechwolfAction.encode(message.action, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
        if (message.articles != null && message.articles.length)
            for (let i = 0; i < message.articles.length; ++i)
                $root.TechwolfArticle.encode(message.articles[i], writer.uint32(/* id 7, wireType 2 =*/58).fork()).ldelim();
        if (message.notify != null && Object.hasOwnProperty.call(message, "notify"))
            $root.TechwolfNotify.encode(message.notify, writer.uint32(/* id 8, wireType 2 =*/66).fork()).ldelim();
        if (message.dialog != null && Object.hasOwnProperty.call(message, "dialog"))
            $root.TechwolfDialog.encode(message.dialog, writer.uint32(/* id 9, wireType 2 =*/74).fork()).ldelim();
        if (message.jobDesc != null && Object.hasOwnProperty.call(message, "jobDesc"))
            $root.TechwolfJobDesc.encode(message.jobDesc, writer.uint32(/* id 10, wireType 2 =*/82).fork()).ldelim();
        if (message.headTitle != null && Object.hasOwnProperty.call(message, "headTitle"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.headTitle);
        if (message.resume != null && Object.hasOwnProperty.call(message, "resume"))
            $root.TechwolfResume.encode(message.resume, writer.uint32(/* id 12, wireType 2 =*/98).fork()).ldelim();
        if (message.redEnvelope != null && Object.hasOwnProperty.call(message, "redEnvelope"))
            $root.TechwolfRedEnvelope.encode(message.redEnvelope, writer.uint32(/* id 13, wireType 2 =*/106).fork()).ldelim();
        if (message.orderDetail != null && Object.hasOwnProperty.call(message, "orderDetail"))
            $root.TechwolfOrderDetail.encode(message.orderDetail, writer.uint32(/* id 14, wireType 2 =*/114).fork()).ldelim();
        if (message.hyperLink != null && Object.hasOwnProperty.call(message, "hyperLink"))
            $root.TechwolfHyperLink.encode(message.hyperLink, writer.uint32(/* id 15, wireType 2 =*/122).fork()).ldelim();
        if (message.video != null && Object.hasOwnProperty.call(message, "video"))
            $root.TechwolfVideo.encode(message.video, writer.uint32(/* id 16, wireType 2 =*/130).fork()).ldelim();
        if (message.interview != null && Object.hasOwnProperty.call(message, "interview"))
            $root.TechwolfInterview.encode(message.interview, writer.uint32(/* id 17, wireType 2 =*/138).fork()).ldelim();
        if (message.jobShare != null && Object.hasOwnProperty.call(message, "jobShare"))
            $root.TechwolfJobShare.encode(message.jobShare, writer.uint32(/* id 18, wireType 2 =*/146).fork()).ldelim();
        if (message.resumeShare != null && Object.hasOwnProperty.call(message, "resumeShare"))
            $root.TechwolfResumeShare.encode(message.resumeShare, writer.uint32(/* id 19, wireType 2 =*/154).fork()).ldelim();
        if (message.atInfo != null && Object.hasOwnProperty.call(message, "atInfo"))
            $root.AtInfo.encode(message.atInfo, writer.uint32(/* id 20, wireType 2 =*/162).fork()).ldelim();
        if (message.sticker != null && Object.hasOwnProperty.call(message, "sticker"))
            $root.TechwolfSticker.encode(message.sticker, writer.uint32(/* id 21, wireType 2 =*/170).fork()).ldelim();
        if (message.chatShare != null && Object.hasOwnProperty.call(message, "chatShare"))
            $root.TechwolfChatShare.encode(message.chatShare, writer.uint32(/* id 22, wireType 2 =*/178).fork()).ldelim();
        if (message.interviewShare != null && Object.hasOwnProperty.call(message, "interviewShare"))
            $root.TechwolfInterviewShare.encode(message.interviewShare, writer.uint32(/* id 23, wireType 2 =*/186).fork()).ldelim();
        if (message.listCard != null && Object.hasOwnProperty.call(message, "listCard"))
            $root.TechwolfListCard.encode(message.listCard, writer.uint32(/* id 24, wireType 2 =*/194).fork()).ldelim();
        if (message.starRate != null && Object.hasOwnProperty.call(message, "starRate"))
            $root.TechwolfStarRate.encode(message.starRate, writer.uint32(/* id 25, wireType 2 =*/202).fork()).ldelim();
        if (message.frame != null && Object.hasOwnProperty.call(message, "frame"))
            $root.TechwolfFrame.encode(message.frame, writer.uint32(/* id 26, wireType 2 =*/210).fork()).ldelim();
        if (message.multiImage != null && Object.hasOwnProperty.call(message, "multiImage"))
            $root.TechwolfMultiImage.encode(message.multiImage, writer.uint32(/* id 27, wireType 2 =*/218).fork()).ldelim();
        if (message.extend != null && Object.hasOwnProperty.call(message, "extend"))
            writer.uint32(/* id 28, wireType 2 =*/226).string(message.extend);
        return writer;
    };

    /**
     * Decodes a TechwolfMessageBody message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfMessageBody
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfMessageBody} TechwolfMessageBody
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfMessageBody.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfMessageBody();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.templateId = reader.int32();
                    break;
                }
            case 11: {
                    message.headTitle = reader.string();
                    break;
                }
            case 3: {
                    message.text = reader.string();
                    break;
                }
            case 4: {
                    message.sound = $root.TechwolfSound.decode(reader, reader.uint32());
                    break;
                }
            case 5: {
                    message.image = $root.TechwolfImage.decode(reader, reader.uint32());
                    break;
                }
            case 6: {
                    message.action = $root.TechwolfAction.decode(reader, reader.uint32());
                    break;
                }
            case 7: {
                    if (!(message.articles && message.articles.length))
                        message.articles = [];
                    message.articles.push($root.TechwolfArticle.decode(reader, reader.uint32()));
                    break;
                }
            case 8: {
                    message.notify = $root.TechwolfNotify.decode(reader, reader.uint32());
                    break;
                }
            case 9: {
                    message.dialog = $root.TechwolfDialog.decode(reader, reader.uint32());
                    break;
                }
            case 10: {
                    message.jobDesc = $root.TechwolfJobDesc.decode(reader, reader.uint32());
                    break;
                }
            case 12: {
                    message.resume = $root.TechwolfResume.decode(reader, reader.uint32());
                    break;
                }
            case 13: {
                    message.redEnvelope = $root.TechwolfRedEnvelope.decode(reader, reader.uint32());
                    break;
                }
            case 14: {
                    message.orderDetail = $root.TechwolfOrderDetail.decode(reader, reader.uint32());
                    break;
                }
            case 15: {
                    message.hyperLink = $root.TechwolfHyperLink.decode(reader, reader.uint32());
                    break;
                }
            case 16: {
                    message.video = $root.TechwolfVideo.decode(reader, reader.uint32());
                    break;
                }
            case 17: {
                    message.interview = $root.TechwolfInterview.decode(reader, reader.uint32());
                    break;
                }
            case 18: {
                    message.jobShare = $root.TechwolfJobShare.decode(reader, reader.uint32());
                    break;
                }
            case 19: {
                    message.resumeShare = $root.TechwolfResumeShare.decode(reader, reader.uint32());
                    break;
                }
            case 20: {
                    message.atInfo = $root.AtInfo.decode(reader, reader.uint32());
                    break;
                }
            case 21: {
                    message.sticker = $root.TechwolfSticker.decode(reader, reader.uint32());
                    break;
                }
            case 22: {
                    message.chatShare = $root.TechwolfChatShare.decode(reader, reader.uint32());
                    break;
                }
            case 23: {
                    message.interviewShare = $root.TechwolfInterviewShare.decode(reader, reader.uint32());
                    break;
                }
            case 24: {
                    message.listCard = $root.TechwolfListCard.decode(reader, reader.uint32());
                    break;
                }
            case 25: {
                    message.starRate = $root.TechwolfStarRate.decode(reader, reader.uint32());
                    break;
                }
            case 26: {
                    message.frame = $root.TechwolfFrame.decode(reader, reader.uint32());
                    break;
                }
            case 27: {
                    message.multiImage = $root.TechwolfMultiImage.decode(reader, reader.uint32());
                    break;
                }
            case 28: {
                    message.extend = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        if (!message.hasOwnProperty("templateId"))
            throw $util.ProtocolError("missing required 'templateId'", { instance: message });
        return message;
    };

    return TechwolfMessageBody;
})();

export const TechwolfMessage = $root.TechwolfMessage = (() => {

    /**
     * Properties of a TechwolfMessage.
     * @exports ITechwolfMessage
     * @interface ITechwolfMessage
     * @property {ITechwolfUser} from TechwolfMessage from
     * @property {ITechwolfUser} to TechwolfMessage to
     * @property {number} type TechwolfMessage type
     * @property {Long|null} [mid] TechwolfMessage mid
     * @property {Long|null} [time] TechwolfMessage time
     * @property {ITechwolfMessageBody} body TechwolfMessage body
     * @property {boolean|null} [offline] TechwolfMessage offline
     * @property {boolean|null} [received] TechwolfMessage received
     * @property {string|null} [pushText] TechwolfMessage pushText
     * @property {Long|null} [taskId] TechwolfMessage taskId
     * @property {Long|null} [cmid] TechwolfMessage cmid
     * @property {number|null} [status] TechwolfMessage status
     * @property {number|null} [uncount] TechwolfMessage uncount
     * @property {number|null} [pushSound] TechwolfMessage pushSound
     * @property {number|null} [flag] TechwolfMessage flag
     * @property {Uint8Array|null} [encryptedBody] TechwolfMessage encryptedBody
     * @property {string|null} [bizId] TechwolfMessage bizId
     * @property {number|null} [bizType] TechwolfMessage bizType
     * @property {string|null} [securityId] TechwolfMessage securityId
     */

    /**
     * Constructs a new TechwolfMessage.
     * @exports TechwolfMessage
     * @classdesc Represents a TechwolfMessage.
     * @implements ITechwolfMessage
     * @constructor
     * @param {ITechwolfMessage=} [properties] Properties to set
     */
    function TechwolfMessage(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfMessage from.
     * @member {ITechwolfUser} from
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.from = null;

    /**
     * TechwolfMessage to.
     * @member {ITechwolfUser} to
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.to = null;

    /**
     * TechwolfMessage type.
     * @member {number} type
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.type = 0;

    /**
     * TechwolfMessage mid.
     * @member {Long} mid
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.mid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessage time.
     * @member {Long} time
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.time = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessage body.
     * @member {ITechwolfMessageBody} body
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.body = null;

    /**
     * TechwolfMessage offline.
     * @member {boolean} offline
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.offline = false;

    /**
     * TechwolfMessage received.
     * @member {boolean} received
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.received = false;

    /**
     * TechwolfMessage pushText.
     * @member {string} pushText
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.pushText = "";

    /**
     * TechwolfMessage taskId.
     * @member {Long} taskId
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.taskId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessage cmid.
     * @member {Long} cmid
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.cmid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessage status.
     * @member {number} status
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.status = 0;

    /**
     * TechwolfMessage uncount.
     * @member {number} uncount
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.uncount = 0;

    /**
     * TechwolfMessage pushSound.
     * @member {number} pushSound
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.pushSound = 0;

    /**
     * TechwolfMessage flag.
     * @member {number} flag
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.flag = 0;

    /**
     * TechwolfMessage encryptedBody.
     * @member {Uint8Array} encryptedBody
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.encryptedBody = $util.newBuffer([]);

    /**
     * TechwolfMessage bizId.
     * @member {string} bizId
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.bizId = "";

    /**
     * TechwolfMessage bizType.
     * @member {number} bizType
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.bizType = 0;

    /**
     * TechwolfMessage securityId.
     * @member {string} securityId
     * @memberof TechwolfMessage
     * @instance
     */
    TechwolfMessage.prototype.securityId = "";

    /**
     * Creates a new TechwolfMessage instance using the specified properties.
     * @function create
     * @memberof TechwolfMessage
     * @static
     * @param {ITechwolfMessage=} [properties] Properties to set
     * @returns {TechwolfMessage} TechwolfMessage instance
     */
    TechwolfMessage.create = function create(properties) {
        return new TechwolfMessage(properties);
    };

    /**
     * Encodes the specified TechwolfMessage message. Does not implicitly {@link TechwolfMessage.verify|verify} messages.
     * @function encode
     * @memberof TechwolfMessage
     * @static
     * @param {ITechwolfMessage} message TechwolfMessage message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfMessage.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        $root.TechwolfUser.encode(message.from, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        $root.TechwolfUser.encode(message.to, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.type);
        if (message.mid != null && Object.hasOwnProperty.call(message, "mid"))
            writer.uint32(/* id 4, wireType 0 =*/32).int64(message.mid);
        if (message.time != null && Object.hasOwnProperty.call(message, "time"))
            writer.uint32(/* id 5, wireType 0 =*/40).int64(message.time);
        $root.TechwolfMessageBody.encode(message.body, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
        if (message.offline != null && Object.hasOwnProperty.call(message, "offline"))
            writer.uint32(/* id 7, wireType 0 =*/56).bool(message.offline);
        if (message.received != null && Object.hasOwnProperty.call(message, "received"))
            writer.uint32(/* id 8, wireType 0 =*/64).bool(message.received);
        if (message.pushText != null && Object.hasOwnProperty.call(message, "pushText"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.pushText);
        if (message.taskId != null && Object.hasOwnProperty.call(message, "taskId"))
            writer.uint32(/* id 10, wireType 0 =*/80).int64(message.taskId);
        if (message.cmid != null && Object.hasOwnProperty.call(message, "cmid"))
            writer.uint32(/* id 11, wireType 0 =*/88).int64(message.cmid);
        if (message.status != null && Object.hasOwnProperty.call(message, "status"))
            writer.uint32(/* id 12, wireType 0 =*/96).int32(message.status);
        if (message.uncount != null && Object.hasOwnProperty.call(message, "uncount"))
            writer.uint32(/* id 13, wireType 0 =*/104).int32(message.uncount);
        if (message.pushSound != null && Object.hasOwnProperty.call(message, "pushSound"))
            writer.uint32(/* id 14, wireType 0 =*/112).int32(message.pushSound);
        if (message.flag != null && Object.hasOwnProperty.call(message, "flag"))
            writer.uint32(/* id 15, wireType 0 =*/120).int32(message.flag);
        if (message.encryptedBody != null && Object.hasOwnProperty.call(message, "encryptedBody"))
            writer.uint32(/* id 16, wireType 2 =*/130).bytes(message.encryptedBody);
        if (message.bizId != null && Object.hasOwnProperty.call(message, "bizId"))
            writer.uint32(/* id 17, wireType 2 =*/138).string(message.bizId);
        if (message.bizType != null && Object.hasOwnProperty.call(message, "bizType"))
            writer.uint32(/* id 18, wireType 0 =*/144).int32(message.bizType);
        if (message.securityId != null && Object.hasOwnProperty.call(message, "securityId"))
            writer.uint32(/* id 19, wireType 2 =*/154).string(message.securityId);
        return writer;
    };

    /**
     * Decodes a TechwolfMessage message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfMessage
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfMessage} TechwolfMessage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfMessage.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfMessage();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.from = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 2: {
                    message.to = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 3: {
                    message.type = reader.int32();
                    break;
                }
            case 4: {
                    message.mid = reader.int64();
                    break;
                }
            case 5: {
                    message.time = reader.int64();
                    break;
                }
            case 6: {
                    message.body = $root.TechwolfMessageBody.decode(reader, reader.uint32());
                    break;
                }
            case 7: {
                    message.offline = reader.bool();
                    break;
                }
            case 8: {
                    message.received = reader.bool();
                    break;
                }
            case 9: {
                    message.pushText = reader.string();
                    break;
                }
            case 10: {
                    message.taskId = reader.int64();
                    break;
                }
            case 11: {
                    message.cmid = reader.int64();
                    break;
                }
            case 12: {
                    message.status = reader.int32();
                    break;
                }
            case 13: {
                    message.uncount = reader.int32();
                    break;
                }
            case 14: {
                    message.pushSound = reader.int32();
                    break;
                }
            case 15: {
                    message.flag = reader.int32();
                    break;
                }
            case 16: {
                    message.encryptedBody = reader.bytes();
                    break;
                }
            case 17: {
                    message.bizId = reader.string();
                    break;
                }
            case 18: {
                    message.bizType = reader.int32();
                    break;
                }
            case 19: {
                    message.securityId = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("from"))
            throw $util.ProtocolError("missing required 'from'", { instance: message });
        if (!message.hasOwnProperty("to"))
            throw $util.ProtocolError("missing required 'to'", { instance: message });
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        if (!message.hasOwnProperty("body"))
            throw $util.ProtocolError("missing required 'body'", { instance: message });
        return message;
    };

    return TechwolfMessage;
})();

export const TechwolfClientInfo = $root.TechwolfClientInfo = (() => {

    /**
     * Properties of a TechwolfClientInfo.
     * @exports ITechwolfClientInfo
     * @interface ITechwolfClientInfo
     * @property {string|null} [version] TechwolfClientInfo version
     * @property {string|null} [system] TechwolfClientInfo system
     * @property {string|null} [systemVersion] TechwolfClientInfo systemVersion
     * @property {string|null} [model] TechwolfClientInfo model
     * @property {string|null} [uniqid] TechwolfClientInfo uniqid
     * @property {string|null} [network] TechwolfClientInfo network
     * @property {number|null} [appid] TechwolfClientInfo appid
     * @property {string|null} [platform] TechwolfClientInfo platform
     * @property {string|null} [channel] TechwolfClientInfo channel
     * @property {string|null} [ssid] TechwolfClientInfo ssid
     * @property {string|null} [bssid] TechwolfClientInfo bssid
     * @property {number|null} [longitude] TechwolfClientInfo longitude
     * @property {number|null} [latitude] TechwolfClientInfo latitude
     */

    /**
     * Constructs a new TechwolfClientInfo.
     * @exports TechwolfClientInfo
     * @classdesc Represents a TechwolfClientInfo.
     * @implements ITechwolfClientInfo
     * @constructor
     * @param {ITechwolfClientInfo=} [properties] Properties to set
     */
    function TechwolfClientInfo(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfClientInfo version.
     * @member {string} version
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.version = "";

    /**
     * TechwolfClientInfo system.
     * @member {string} system
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.system = "";

    /**
     * TechwolfClientInfo systemVersion.
     * @member {string} systemVersion
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.systemVersion = "";

    /**
     * TechwolfClientInfo model.
     * @member {string} model
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.model = "";

    /**
     * TechwolfClientInfo uniqid.
     * @member {string} uniqid
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.uniqid = "";

    /**
     * TechwolfClientInfo network.
     * @member {string} network
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.network = "";

    /**
     * TechwolfClientInfo appid.
     * @member {number} appid
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.appid = 0;

    /**
     * TechwolfClientInfo platform.
     * @member {string} platform
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.platform = "";

    /**
     * TechwolfClientInfo channel.
     * @member {string} channel
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.channel = "";

    /**
     * TechwolfClientInfo ssid.
     * @member {string} ssid
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.ssid = "";

    /**
     * TechwolfClientInfo bssid.
     * @member {string} bssid
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.bssid = "";

    /**
     * TechwolfClientInfo longitude.
     * @member {number} longitude
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.longitude = 0;

    /**
     * TechwolfClientInfo latitude.
     * @member {number} latitude
     * @memberof TechwolfClientInfo
     * @instance
     */
    TechwolfClientInfo.prototype.latitude = 0;

    /**
     * Creates a new TechwolfClientInfo instance using the specified properties.
     * @function create
     * @memberof TechwolfClientInfo
     * @static
     * @param {ITechwolfClientInfo=} [properties] Properties to set
     * @returns {TechwolfClientInfo} TechwolfClientInfo instance
     */
    TechwolfClientInfo.create = function create(properties) {
        return new TechwolfClientInfo(properties);
    };

    /**
     * Encodes the specified TechwolfClientInfo message. Does not implicitly {@link TechwolfClientInfo.verify|verify} messages.
     * @function encode
     * @memberof TechwolfClientInfo
     * @static
     * @param {ITechwolfClientInfo} message TechwolfClientInfo message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfClientInfo.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.version != null && Object.hasOwnProperty.call(message, "version"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.version);
        if (message.system != null && Object.hasOwnProperty.call(message, "system"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.system);
        if (message.systemVersion != null && Object.hasOwnProperty.call(message, "systemVersion"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.systemVersion);
        if (message.model != null && Object.hasOwnProperty.call(message, "model"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.model);
        if (message.uniqid != null && Object.hasOwnProperty.call(message, "uniqid"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.uniqid);
        if (message.network != null && Object.hasOwnProperty.call(message, "network"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.network);
        if (message.appid != null && Object.hasOwnProperty.call(message, "appid"))
            writer.uint32(/* id 7, wireType 0 =*/56).int32(message.appid);
        if (message.platform != null && Object.hasOwnProperty.call(message, "platform"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.platform);
        if (message.channel != null && Object.hasOwnProperty.call(message, "channel"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.channel);
        if (message.ssid != null && Object.hasOwnProperty.call(message, "ssid"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.ssid);
        if (message.bssid != null && Object.hasOwnProperty.call(message, "bssid"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.bssid);
        if (message.longitude != null && Object.hasOwnProperty.call(message, "longitude"))
            writer.uint32(/* id 12, wireType 1 =*/97).double(message.longitude);
        if (message.latitude != null && Object.hasOwnProperty.call(message, "latitude"))
            writer.uint32(/* id 13, wireType 1 =*/105).double(message.latitude);
        return writer;
    };

    /**
     * Decodes a TechwolfClientInfo message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfClientInfo
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfClientInfo} TechwolfClientInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfClientInfo.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfClientInfo();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.version = reader.string();
                    break;
                }
            case 2: {
                    message.system = reader.string();
                    break;
                }
            case 3: {
                    message.systemVersion = reader.string();
                    break;
                }
            case 4: {
                    message.model = reader.string();
                    break;
                }
            case 5: {
                    message.uniqid = reader.string();
                    break;
                }
            case 6: {
                    message.network = reader.string();
                    break;
                }
            case 7: {
                    message.appid = reader.int32();
                    break;
                }
            case 8: {
                    message.platform = reader.string();
                    break;
                }
            case 9: {
                    message.channel = reader.string();
                    break;
                }
            case 10: {
                    message.ssid = reader.string();
                    break;
                }
            case 11: {
                    message.bssid = reader.string();
                    break;
                }
            case 12: {
                    message.longitude = reader.double();
                    break;
                }
            case 13: {
                    message.latitude = reader.double();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfClientInfo;
})();

export const TechwolfClientTime = $root.TechwolfClientTime = (() => {

    /**
     * Properties of a TechwolfClientTime.
     * @exports ITechwolfClientTime
     * @interface ITechwolfClientTime
     * @property {Long|null} [startTime] TechwolfClientTime startTime
     * @property {Long|null} [resumeTime] TechwolfClientTime resumeTime
     */

    /**
     * Constructs a new TechwolfClientTime.
     * @exports TechwolfClientTime
     * @classdesc Represents a TechwolfClientTime.
     * @implements ITechwolfClientTime
     * @constructor
     * @param {ITechwolfClientTime=} [properties] Properties to set
     */
    function TechwolfClientTime(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfClientTime startTime.
     * @member {Long} startTime
     * @memberof TechwolfClientTime
     * @instance
     */
    TechwolfClientTime.prototype.startTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfClientTime resumeTime.
     * @member {Long} resumeTime
     * @memberof TechwolfClientTime
     * @instance
     */
    TechwolfClientTime.prototype.resumeTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Creates a new TechwolfClientTime instance using the specified properties.
     * @function create
     * @memberof TechwolfClientTime
     * @static
     * @param {ITechwolfClientTime=} [properties] Properties to set
     * @returns {TechwolfClientTime} TechwolfClientTime instance
     */
    TechwolfClientTime.create = function create(properties) {
        return new TechwolfClientTime(properties);
    };

    /**
     * Encodes the specified TechwolfClientTime message. Does not implicitly {@link TechwolfClientTime.verify|verify} messages.
     * @function encode
     * @memberof TechwolfClientTime
     * @static
     * @param {ITechwolfClientTime} message TechwolfClientTime message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfClientTime.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.startTime != null && Object.hasOwnProperty.call(message, "startTime"))
            writer.uint32(/* id 1, wireType 0 =*/8).int64(message.startTime);
        if (message.resumeTime != null && Object.hasOwnProperty.call(message, "resumeTime"))
            writer.uint32(/* id 2, wireType 0 =*/16).int64(message.resumeTime);
        return writer;
    };

    /**
     * Decodes a TechwolfClientTime message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfClientTime
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfClientTime} TechwolfClientTime
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfClientTime.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfClientTime();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.startTime = reader.int64();
                    break;
                }
            case 2: {
                    message.resumeTime = reader.int64();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfClientTime;
})();

export const TechwolfPresence = $root.TechwolfPresence = (() => {

    /**
     * Properties of a TechwolfPresence.
     * @exports ITechwolfPresence
     * @interface ITechwolfPresence
     * @property {number} type TechwolfPresence type
     * @property {number} uid TechwolfPresence uid
     * @property {ITechwolfClientInfo|null} [clientInfo] TechwolfPresence clientInfo
     * @property {ITechwolfClientTime|null} [clientTime] TechwolfPresence clientTime
     * @property {Long|null} [lastMessageId] TechwolfPresence lastMessageId
     * @property {Long|null} [lastGroupMessageId] TechwolfPresence lastGroupMessageId
     * @property {Long|null} [userId] TechwolfPresence userId
     */

    /**
     * Constructs a new TechwolfPresence.
     * @exports TechwolfPresence
     * @classdesc Represents a TechwolfPresence.
     * @implements ITechwolfPresence
     * @constructor
     * @param {ITechwolfPresence=} [properties] Properties to set
     */
    function TechwolfPresence(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfPresence type.
     * @member {number} type
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.type = 0;

    /**
     * TechwolfPresence uid.
     * @member {number} uid
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.uid = 0;

    /**
     * TechwolfPresence clientInfo.
     * @member {ITechwolfClientInfo|null|undefined} clientInfo
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.clientInfo = null;

    /**
     * TechwolfPresence clientTime.
     * @member {ITechwolfClientTime|null|undefined} clientTime
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.clientTime = null;

    /**
     * TechwolfPresence lastMessageId.
     * @member {Long} lastMessageId
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.lastMessageId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfPresence lastGroupMessageId.
     * @member {Long} lastGroupMessageId
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.lastGroupMessageId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfPresence userId.
     * @member {Long} userId
     * @memberof TechwolfPresence
     * @instance
     */
    TechwolfPresence.prototype.userId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Creates a new TechwolfPresence instance using the specified properties.
     * @function create
     * @memberof TechwolfPresence
     * @static
     * @param {ITechwolfPresence=} [properties] Properties to set
     * @returns {TechwolfPresence} TechwolfPresence instance
     */
    TechwolfPresence.create = function create(properties) {
        return new TechwolfPresence(properties);
    };

    /**
     * Encodes the specified TechwolfPresence message. Does not implicitly {@link TechwolfPresence.verify|verify} messages.
     * @function encode
     * @memberof TechwolfPresence
     * @static
     * @param {ITechwolfPresence} message TechwolfPresence message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfPresence.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.uid);
        if (message.clientInfo != null && Object.hasOwnProperty.call(message, "clientInfo"))
            $root.TechwolfClientInfo.encode(message.clientInfo, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        if (message.clientTime != null && Object.hasOwnProperty.call(message, "clientTime"))
            $root.TechwolfClientTime.encode(message.clientTime, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
        if (message.lastMessageId != null && Object.hasOwnProperty.call(message, "lastMessageId"))
            writer.uint32(/* id 5, wireType 0 =*/40).int64(message.lastMessageId);
        if (message.lastGroupMessageId != null && Object.hasOwnProperty.call(message, "lastGroupMessageId"))
            writer.uint32(/* id 6, wireType 0 =*/48).int64(message.lastGroupMessageId);
        if (message.userId != null && Object.hasOwnProperty.call(message, "userId"))
            writer.uint32(/* id 7, wireType 0 =*/56).int64(message.userId);
        return writer;
    };

    /**
     * Decodes a TechwolfPresence message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfPresence
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfPresence} TechwolfPresence
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfPresence.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfPresence();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.uid = reader.int32();
                    break;
                }
            case 3: {
                    message.clientInfo = $root.TechwolfClientInfo.decode(reader, reader.uint32());
                    break;
                }
            case 4: {
                    message.clientTime = $root.TechwolfClientTime.decode(reader, reader.uint32());
                    break;
                }
            case 5: {
                    message.lastMessageId = reader.int64();
                    break;
                }
            case 6: {
                    message.lastGroupMessageId = reader.int64();
                    break;
                }
            case 7: {
                    message.userId = reader.int64();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        if (!message.hasOwnProperty("uid"))
            throw $util.ProtocolError("missing required 'uid'", { instance: message });
        return message;
    };

    return TechwolfPresence;
})();

export const TechwolfKVEntry = $root.TechwolfKVEntry = (() => {

    /**
     * Properties of a TechwolfKVEntry.
     * @exports ITechwolfKVEntry
     * @interface ITechwolfKVEntry
     * @property {string} key TechwolfKVEntry key
     * @property {string} value TechwolfKVEntry value
     */

    /**
     * Constructs a new TechwolfKVEntry.
     * @exports TechwolfKVEntry
     * @classdesc Represents a TechwolfKVEntry.
     * @implements ITechwolfKVEntry
     * @constructor
     * @param {ITechwolfKVEntry=} [properties] Properties to set
     */
    function TechwolfKVEntry(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfKVEntry key.
     * @member {string} key
     * @memberof TechwolfKVEntry
     * @instance
     */
    TechwolfKVEntry.prototype.key = "";

    /**
     * TechwolfKVEntry value.
     * @member {string} value
     * @memberof TechwolfKVEntry
     * @instance
     */
    TechwolfKVEntry.prototype.value = "";

    /**
     * Creates a new TechwolfKVEntry instance using the specified properties.
     * @function create
     * @memberof TechwolfKVEntry
     * @static
     * @param {ITechwolfKVEntry=} [properties] Properties to set
     * @returns {TechwolfKVEntry} TechwolfKVEntry instance
     */
    TechwolfKVEntry.create = function create(properties) {
        return new TechwolfKVEntry(properties);
    };

    /**
     * Encodes the specified TechwolfKVEntry message. Does not implicitly {@link TechwolfKVEntry.verify|verify} messages.
     * @function encode
     * @memberof TechwolfKVEntry
     * @static
     * @param {ITechwolfKVEntry} message TechwolfKVEntry message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfKVEntry.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.key);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.value);
        return writer;
    };

    /**
     * Decodes a TechwolfKVEntry message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfKVEntry
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfKVEntry} TechwolfKVEntry
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfKVEntry.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfKVEntry();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.key = reader.string();
                    break;
                }
            case 2: {
                    message.value = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("key"))
            throw $util.ProtocolError("missing required 'key'", { instance: message });
        if (!message.hasOwnProperty("value"))
            throw $util.ProtocolError("missing required 'value'", { instance: message });
        return message;
    };

    return TechwolfKVEntry;
})();

export const TechwolfIq = $root.TechwolfIq = (() => {

    /**
     * Properties of a TechwolfIq.
     * @exports ITechwolfIq
     * @interface ITechwolfIq
     * @property {Long} qid TechwolfIq qid
     * @property {string} query TechwolfIq query
     * @property {Array.<ITechwolfKVEntry>|null} [params] TechwolfIq params
     */

    /**
     * Constructs a new TechwolfIq.
     * @exports TechwolfIq
     * @classdesc Represents a TechwolfIq.
     * @implements ITechwolfIq
     * @constructor
     * @param {ITechwolfIq=} [properties] Properties to set
     */
    function TechwolfIq(properties) {
        this.params = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfIq qid.
     * @member {Long} qid
     * @memberof TechwolfIq
     * @instance
     */
    TechwolfIq.prototype.qid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfIq query.
     * @member {string} query
     * @memberof TechwolfIq
     * @instance
     */
    TechwolfIq.prototype.query = "";

    /**
     * TechwolfIq params.
     * @member {Array.<ITechwolfKVEntry>} params
     * @memberof TechwolfIq
     * @instance
     */
    TechwolfIq.prototype.params = $util.emptyArray;

    /**
     * Creates a new TechwolfIq instance using the specified properties.
     * @function create
     * @memberof TechwolfIq
     * @static
     * @param {ITechwolfIq=} [properties] Properties to set
     * @returns {TechwolfIq} TechwolfIq instance
     */
    TechwolfIq.create = function create(properties) {
        return new TechwolfIq(properties);
    };

    /**
     * Encodes the specified TechwolfIq message. Does not implicitly {@link TechwolfIq.verify|verify} messages.
     * @function encode
     * @memberof TechwolfIq
     * @static
     * @param {ITechwolfIq} message TechwolfIq message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfIq.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.qid);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.query);
        if (message.params != null && message.params.length)
            for (let i = 0; i < message.params.length; ++i)
                $root.TechwolfKVEntry.encode(message.params[i], writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfIq message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfIq
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfIq} TechwolfIq
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfIq.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfIq();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.qid = reader.int64();
                    break;
                }
            case 2: {
                    message.query = reader.string();
                    break;
                }
            case 3: {
                    if (!(message.params && message.params.length))
                        message.params = [];
                    message.params.push($root.TechwolfKVEntry.decode(reader, reader.uint32()));
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("qid"))
            throw $util.ProtocolError("missing required 'qid'", { instance: message });
        if (!message.hasOwnProperty("query"))
            throw $util.ProtocolError("missing required 'query'", { instance: message });
        return message;
    };

    return TechwolfIq;
})();

export const TechwolfIqResponse = $root.TechwolfIqResponse = (() => {

    /**
     * Properties of a TechwolfIqResponse.
     * @exports ITechwolfIqResponse
     * @interface ITechwolfIqResponse
     * @property {Long} qid TechwolfIqResponse qid
     * @property {string} query TechwolfIqResponse query
     * @property {Array.<ITechwolfKVEntry>|null} [results] TechwolfIqResponse results
     */

    /**
     * Constructs a new TechwolfIqResponse.
     * @exports TechwolfIqResponse
     * @classdesc Represents a TechwolfIqResponse.
     * @implements ITechwolfIqResponse
     * @constructor
     * @param {ITechwolfIqResponse=} [properties] Properties to set
     */
    function TechwolfIqResponse(properties) {
        this.results = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfIqResponse qid.
     * @member {Long} qid
     * @memberof TechwolfIqResponse
     * @instance
     */
    TechwolfIqResponse.prototype.qid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfIqResponse query.
     * @member {string} query
     * @memberof TechwolfIqResponse
     * @instance
     */
    TechwolfIqResponse.prototype.query = "";

    /**
     * TechwolfIqResponse results.
     * @member {Array.<ITechwolfKVEntry>} results
     * @memberof TechwolfIqResponse
     * @instance
     */
    TechwolfIqResponse.prototype.results = $util.emptyArray;

    /**
     * Creates a new TechwolfIqResponse instance using the specified properties.
     * @function create
     * @memberof TechwolfIqResponse
     * @static
     * @param {ITechwolfIqResponse=} [properties] Properties to set
     * @returns {TechwolfIqResponse} TechwolfIqResponse instance
     */
    TechwolfIqResponse.create = function create(properties) {
        return new TechwolfIqResponse(properties);
    };

    /**
     * Encodes the specified TechwolfIqResponse message. Does not implicitly {@link TechwolfIqResponse.verify|verify} messages.
     * @function encode
     * @memberof TechwolfIqResponse
     * @static
     * @param {ITechwolfIqResponse} message TechwolfIqResponse message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfIqResponse.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.qid);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.query);
        if (message.results != null && message.results.length)
            for (let i = 0; i < message.results.length; ++i)
                $root.TechwolfKVEntry.encode(message.results[i], writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfIqResponse message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfIqResponse
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfIqResponse} TechwolfIqResponse
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfIqResponse.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfIqResponse();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.qid = reader.int64();
                    break;
                }
            case 2: {
                    message.query = reader.string();
                    break;
                }
            case 3: {
                    if (!(message.results && message.results.length))
                        message.results = [];
                    message.results.push($root.TechwolfKVEntry.decode(reader, reader.uint32()));
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("qid"))
            throw $util.ProtocolError("missing required 'qid'", { instance: message });
        if (!message.hasOwnProperty("query"))
            throw $util.ProtocolError("missing required 'query'", { instance: message });
        return message;
    };

    return TechwolfIqResponse;
})();

export const TechwolfMessageSync = $root.TechwolfMessageSync = (() => {

    /**
     * Properties of a TechwolfMessageSync.
     * @exports ITechwolfMessageSync
     * @interface ITechwolfMessageSync
     * @property {Long} clientMid TechwolfMessageSync clientMid
     * @property {Long} serverMid TechwolfMessageSync serverMid
     */

    /**
     * Constructs a new TechwolfMessageSync.
     * @exports TechwolfMessageSync
     * @classdesc Represents a TechwolfMessageSync.
     * @implements ITechwolfMessageSync
     * @constructor
     * @param {ITechwolfMessageSync=} [properties] Properties to set
     */
    function TechwolfMessageSync(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfMessageSync clientMid.
     * @member {Long} clientMid
     * @memberof TechwolfMessageSync
     * @instance
     */
    TechwolfMessageSync.prototype.clientMid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessageSync serverMid.
     * @member {Long} serverMid
     * @memberof TechwolfMessageSync
     * @instance
     */
    TechwolfMessageSync.prototype.serverMid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * Creates a new TechwolfMessageSync instance using the specified properties.
     * @function create
     * @memberof TechwolfMessageSync
     * @static
     * @param {ITechwolfMessageSync=} [properties] Properties to set
     * @returns {TechwolfMessageSync} TechwolfMessageSync instance
     */
    TechwolfMessageSync.create = function create(properties) {
        return new TechwolfMessageSync(properties);
    };

    /**
     * Encodes the specified TechwolfMessageSync message. Does not implicitly {@link TechwolfMessageSync.verify|verify} messages.
     * @function encode
     * @memberof TechwolfMessageSync
     * @static
     * @param {ITechwolfMessageSync} message TechwolfMessageSync message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfMessageSync.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.clientMid);
        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.serverMid);
        return writer;
    };

    /**
     * Decodes a TechwolfMessageSync message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfMessageSync
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfMessageSync} TechwolfMessageSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfMessageSync.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfMessageSync();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.clientMid = reader.int64();
                    break;
                }
            case 2: {
                    message.serverMid = reader.int64();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("clientMid"))
            throw $util.ProtocolError("missing required 'clientMid'", { instance: message });
        if (!message.hasOwnProperty("serverMid"))
            throw $util.ProtocolError("missing required 'serverMid'", { instance: message });
        return message;
    };

    return TechwolfMessageSync;
})();

export const TechwolfMessageRead = $root.TechwolfMessageRead = (() => {

    /**
     * Properties of a TechwolfMessageRead.
     * @exports ITechwolfMessageRead
     * @interface ITechwolfMessageRead
     * @property {Long} userId TechwolfMessageRead userId
     * @property {Long} messageId TechwolfMessageRead messageId
     * @property {Long} readTime TechwolfMessageRead readTime
     * @property {boolean|null} [sync] TechwolfMessageRead sync
     * @property {number|null} [userSource] TechwolfMessageRead userSource
     */

    /**
     * Constructs a new TechwolfMessageRead.
     * @exports TechwolfMessageRead
     * @classdesc Represents a TechwolfMessageRead.
     * @implements ITechwolfMessageRead
     * @constructor
     * @param {ITechwolfMessageRead=} [properties] Properties to set
     */
    function TechwolfMessageRead(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfMessageRead userId.
     * @member {Long} userId
     * @memberof TechwolfMessageRead
     * @instance
     */
    TechwolfMessageRead.prototype.userId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessageRead messageId.
     * @member {Long} messageId
     * @memberof TechwolfMessageRead
     * @instance
     */
    TechwolfMessageRead.prototype.messageId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessageRead readTime.
     * @member {Long} readTime
     * @memberof TechwolfMessageRead
     * @instance
     */
    TechwolfMessageRead.prototype.readTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfMessageRead sync.
     * @member {boolean} sync
     * @memberof TechwolfMessageRead
     * @instance
     */
    TechwolfMessageRead.prototype.sync = false;

    /**
     * TechwolfMessageRead userSource.
     * @member {number} userSource
     * @memberof TechwolfMessageRead
     * @instance
     */
    TechwolfMessageRead.prototype.userSource = 0;

    /**
     * Creates a new TechwolfMessageRead instance using the specified properties.
     * @function create
     * @memberof TechwolfMessageRead
     * @static
     * @param {ITechwolfMessageRead=} [properties] Properties to set
     * @returns {TechwolfMessageRead} TechwolfMessageRead instance
     */
    TechwolfMessageRead.create = function create(properties) {
        return new TechwolfMessageRead(properties);
    };

    /**
     * Encodes the specified TechwolfMessageRead message. Does not implicitly {@link TechwolfMessageRead.verify|verify} messages.
     * @function encode
     * @memberof TechwolfMessageRead
     * @static
     * @param {ITechwolfMessageRead} message TechwolfMessageRead message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfMessageRead.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.userId);
        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.messageId);
        writer.uint32(/* id 3, wireType 0 =*/24).int64(message.readTime);
        if (message.sync != null && Object.hasOwnProperty.call(message, "sync"))
            writer.uint32(/* id 4, wireType 0 =*/32).bool(message.sync);
        if (message.userSource != null && Object.hasOwnProperty.call(message, "userSource"))
            writer.uint32(/* id 5, wireType 0 =*/40).int32(message.userSource);
        return writer;
    };

    /**
     * Decodes a TechwolfMessageRead message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfMessageRead
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfMessageRead} TechwolfMessageRead
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfMessageRead.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfMessageRead();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.userId = reader.int64();
                    break;
                }
            case 2: {
                    message.messageId = reader.int64();
                    break;
                }
            case 3: {
                    message.readTime = reader.int64();
                    break;
                }
            case 4: {
                    message.sync = reader.bool();
                    break;
                }
            case 5: {
                    message.userSource = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("userId"))
            throw $util.ProtocolError("missing required 'userId'", { instance: message });
        if (!message.hasOwnProperty("messageId"))
            throw $util.ProtocolError("missing required 'messageId'", { instance: message });
        if (!message.hasOwnProperty("readTime"))
            throw $util.ProtocolError("missing required 'readTime'", { instance: message });
        return message;
    };

    return TechwolfMessageRead;
})();

export const TechwolfChatProtocol = $root.TechwolfChatProtocol = (() => {

    /**
     * Properties of a TechwolfChatProtocol.
     * @exports ITechwolfChatProtocol
     * @interface ITechwolfChatProtocol
     * @property {number} type TechwolfChatProtocol type
     * @property {string|null} [version] TechwolfChatProtocol version
     * @property {Array.<ITechwolfMessage>|null} [messages] TechwolfChatProtocol messages
     * @property {ITechwolfPresence|null} [presence] TechwolfChatProtocol presence
     * @property {ITechwolfIq|null} [iq] TechwolfChatProtocol iq
     * @property {ITechwolfIqResponse|null} [iqResponse] TechwolfChatProtocol iqResponse
     * @property {Array.<ITechwolfMessageSync>|null} [messageSync] TechwolfChatProtocol messageSync
     * @property {Array.<ITechwolfMessageRead>|null} [messageRead] TechwolfChatProtocol messageRead
     * @property {ITechwolfDataSync|null} [dataSync] TechwolfChatProtocol dataSync
     * @property {number|null} [domain] TechwolfChatProtocol domain
     */

    /**
     * Constructs a new TechwolfChatProtocol.
     * @exports TechwolfChatProtocol
     * @classdesc Represents a TechwolfChatProtocol.
     * @implements ITechwolfChatProtocol
     * @constructor
     * @param {ITechwolfChatProtocol=} [properties] Properties to set
     */
    function TechwolfChatProtocol(properties) {
        this.messages = [];
        this.messageSync = [];
        this.messageRead = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfChatProtocol type.
     * @member {number} type
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.type = 0;

    /**
     * TechwolfChatProtocol version.
     * @member {string} version
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.version = "";

    /**
     * TechwolfChatProtocol messages.
     * @member {Array.<ITechwolfMessage>} messages
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.messages = $util.emptyArray;

    /**
     * TechwolfChatProtocol presence.
     * @member {ITechwolfPresence|null|undefined} presence
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.presence = null;

    /**
     * TechwolfChatProtocol iq.
     * @member {ITechwolfIq|null|undefined} iq
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.iq = null;

    /**
     * TechwolfChatProtocol iqResponse.
     * @member {ITechwolfIqResponse|null|undefined} iqResponse
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.iqResponse = null;

    /**
     * TechwolfChatProtocol messageSync.
     * @member {Array.<ITechwolfMessageSync>} messageSync
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.messageSync = $util.emptyArray;

    /**
     * TechwolfChatProtocol messageRead.
     * @member {Array.<ITechwolfMessageRead>} messageRead
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.messageRead = $util.emptyArray;

    /**
     * TechwolfChatProtocol dataSync.
     * @member {ITechwolfDataSync|null|undefined} dataSync
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.dataSync = null;

    /**
     * TechwolfChatProtocol domain.
     * @member {number} domain
     * @memberof TechwolfChatProtocol
     * @instance
     */
    TechwolfChatProtocol.prototype.domain = 0;

    /**
     * Creates a new TechwolfChatProtocol instance using the specified properties.
     * @function create
     * @memberof TechwolfChatProtocol
     * @static
     * @param {ITechwolfChatProtocol=} [properties] Properties to set
     * @returns {TechwolfChatProtocol} TechwolfChatProtocol instance
     */
    TechwolfChatProtocol.create = function create(properties) {
        return new TechwolfChatProtocol(properties);
    };

    /**
     * Encodes the specified TechwolfChatProtocol message. Does not implicitly {@link TechwolfChatProtocol.verify|verify} messages.
     * @function encode
     * @memberof TechwolfChatProtocol
     * @static
     * @param {ITechwolfChatProtocol} message TechwolfChatProtocol message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfChatProtocol.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        if (message.version != null && Object.hasOwnProperty.call(message, "version"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.version);
        if (message.messages != null && message.messages.length)
            for (let i = 0; i < message.messages.length; ++i)
                $root.TechwolfMessage.encode(message.messages[i], writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        if (message.presence != null && Object.hasOwnProperty.call(message, "presence"))
            $root.TechwolfPresence.encode(message.presence, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
        if (message.iq != null && Object.hasOwnProperty.call(message, "iq"))
            $root.TechwolfIq.encode(message.iq, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
        if (message.iqResponse != null && Object.hasOwnProperty.call(message, "iqResponse"))
            $root.TechwolfIqResponse.encode(message.iqResponse, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
        if (message.messageSync != null && message.messageSync.length)
            for (let i = 0; i < message.messageSync.length; ++i)
                $root.TechwolfMessageSync.encode(message.messageSync[i], writer.uint32(/* id 7, wireType 2 =*/58).fork()).ldelim();
        if (message.messageRead != null && message.messageRead.length)
            for (let i = 0; i < message.messageRead.length; ++i)
                $root.TechwolfMessageRead.encode(message.messageRead[i], writer.uint32(/* id 8, wireType 2 =*/66).fork()).ldelim();
        if (message.dataSync != null && Object.hasOwnProperty.call(message, "dataSync"))
            $root.TechwolfDataSync.encode(message.dataSync, writer.uint32(/* id 9, wireType 2 =*/74).fork()).ldelim();
        if (message.domain != null && Object.hasOwnProperty.call(message, "domain"))
            writer.uint32(/* id 10, wireType 0 =*/80).int32(message.domain);
        return writer;
    };

    /**
     * Decodes a TechwolfChatProtocol message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfChatProtocol
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfChatProtocol} TechwolfChatProtocol
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfChatProtocol.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfChatProtocol();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.version = reader.string();
                    break;
                }
            case 3: {
                    if (!(message.messages && message.messages.length))
                        message.messages = [];
                    message.messages.push($root.TechwolfMessage.decode(reader, reader.uint32()));
                    break;
                }
            case 4: {
                    message.presence = $root.TechwolfPresence.decode(reader, reader.uint32());
                    break;
                }
            case 5: {
                    message.iq = $root.TechwolfIq.decode(reader, reader.uint32());
                    break;
                }
            case 6: {
                    message.iqResponse = $root.TechwolfIqResponse.decode(reader, reader.uint32());
                    break;
                }
            case 7: {
                    if (!(message.messageSync && message.messageSync.length))
                        message.messageSync = [];
                    message.messageSync.push($root.TechwolfMessageSync.decode(reader, reader.uint32()));
                    break;
                }
            case 8: {
                    if (!(message.messageRead && message.messageRead.length))
                        message.messageRead = [];
                    message.messageRead.push($root.TechwolfMessageRead.decode(reader, reader.uint32()));
                    break;
                }
            case 9: {
                    message.dataSync = $root.TechwolfDataSync.decode(reader, reader.uint32());
                    break;
                }
            case 10: {
                    message.domain = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        return message;
    };

    return TechwolfChatProtocol;
})();

export const TechwolfRedEnvelope = $root.TechwolfRedEnvelope = (() => {

    /**
     * Properties of a TechwolfRedEnvelope.
     * @exports ITechwolfRedEnvelope
     * @interface ITechwolfRedEnvelope
     * @property {Long} redId TechwolfRedEnvelope redId
     * @property {string} redText TechwolfRedEnvelope redText
     * @property {string} redTitle TechwolfRedEnvelope redTitle
     * @property {string} clickUrl TechwolfRedEnvelope clickUrl
     */

    /**
     * Constructs a new TechwolfRedEnvelope.
     * @exports TechwolfRedEnvelope
     * @classdesc Represents a TechwolfRedEnvelope.
     * @implements ITechwolfRedEnvelope
     * @constructor
     * @param {ITechwolfRedEnvelope=} [properties] Properties to set
     */
    function TechwolfRedEnvelope(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfRedEnvelope redId.
     * @member {Long} redId
     * @memberof TechwolfRedEnvelope
     * @instance
     */
    TechwolfRedEnvelope.prototype.redId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfRedEnvelope redText.
     * @member {string} redText
     * @memberof TechwolfRedEnvelope
     * @instance
     */
    TechwolfRedEnvelope.prototype.redText = "";

    /**
     * TechwolfRedEnvelope redTitle.
     * @member {string} redTitle
     * @memberof TechwolfRedEnvelope
     * @instance
     */
    TechwolfRedEnvelope.prototype.redTitle = "";

    /**
     * TechwolfRedEnvelope clickUrl.
     * @member {string} clickUrl
     * @memberof TechwolfRedEnvelope
     * @instance
     */
    TechwolfRedEnvelope.prototype.clickUrl = "";

    /**
     * Creates a new TechwolfRedEnvelope instance using the specified properties.
     * @function create
     * @memberof TechwolfRedEnvelope
     * @static
     * @param {ITechwolfRedEnvelope=} [properties] Properties to set
     * @returns {TechwolfRedEnvelope} TechwolfRedEnvelope instance
     */
    TechwolfRedEnvelope.create = function create(properties) {
        return new TechwolfRedEnvelope(properties);
    };

    /**
     * Encodes the specified TechwolfRedEnvelope message. Does not implicitly {@link TechwolfRedEnvelope.verify|verify} messages.
     * @function encode
     * @memberof TechwolfRedEnvelope
     * @static
     * @param {ITechwolfRedEnvelope} message TechwolfRedEnvelope message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfRedEnvelope.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.redId);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.redText);
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.redTitle);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.clickUrl);
        return writer;
    };

    /**
     * Decodes a TechwolfRedEnvelope message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfRedEnvelope
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfRedEnvelope} TechwolfRedEnvelope
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfRedEnvelope.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfRedEnvelope();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.redId = reader.int64();
                    break;
                }
            case 2: {
                    message.redText = reader.string();
                    break;
                }
            case 3: {
                    message.redTitle = reader.string();
                    break;
                }
            case 4: {
                    message.clickUrl = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("redId"))
            throw $util.ProtocolError("missing required 'redId'", { instance: message });
        if (!message.hasOwnProperty("redText"))
            throw $util.ProtocolError("missing required 'redText'", { instance: message });
        if (!message.hasOwnProperty("redTitle"))
            throw $util.ProtocolError("missing required 'redTitle'", { instance: message });
        if (!message.hasOwnProperty("clickUrl"))
            throw $util.ProtocolError("missing required 'clickUrl'", { instance: message });
        return message;
    };

    return TechwolfRedEnvelope;
})();

export const TechwolfOrderDetail = $root.TechwolfOrderDetail = (() => {

    /**
     * Properties of a TechwolfOrderDetail.
     * @exports ITechwolfOrderDetail
     * @interface ITechwolfOrderDetail
     * @property {string} title TechwolfOrderDetail title
     * @property {string} subTitle TechwolfOrderDetail subTitle
     * @property {string|null} [url] TechwolfOrderDetail url
     * @property {Array.<ITechwolfOrderDetailEntry>|null} [orderDetailEntryList] TechwolfOrderDetail orderDetailEntryList
     */

    /**
     * Constructs a new TechwolfOrderDetail.
     * @exports TechwolfOrderDetail
     * @classdesc Represents a TechwolfOrderDetail.
     * @implements ITechwolfOrderDetail
     * @constructor
     * @param {ITechwolfOrderDetail=} [properties] Properties to set
     */
    function TechwolfOrderDetail(properties) {
        this.orderDetailEntryList = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfOrderDetail title.
     * @member {string} title
     * @memberof TechwolfOrderDetail
     * @instance
     */
    TechwolfOrderDetail.prototype.title = "";

    /**
     * TechwolfOrderDetail subTitle.
     * @member {string} subTitle
     * @memberof TechwolfOrderDetail
     * @instance
     */
    TechwolfOrderDetail.prototype.subTitle = "";

    /**
     * TechwolfOrderDetail url.
     * @member {string} url
     * @memberof TechwolfOrderDetail
     * @instance
     */
    TechwolfOrderDetail.prototype.url = "";

    /**
     * TechwolfOrderDetail orderDetailEntryList.
     * @member {Array.<ITechwolfOrderDetailEntry>} orderDetailEntryList
     * @memberof TechwolfOrderDetail
     * @instance
     */
    TechwolfOrderDetail.prototype.orderDetailEntryList = $util.emptyArray;

    /**
     * Creates a new TechwolfOrderDetail instance using the specified properties.
     * @function create
     * @memberof TechwolfOrderDetail
     * @static
     * @param {ITechwolfOrderDetail=} [properties] Properties to set
     * @returns {TechwolfOrderDetail} TechwolfOrderDetail instance
     */
    TechwolfOrderDetail.create = function create(properties) {
        return new TechwolfOrderDetail(properties);
    };

    /**
     * Encodes the specified TechwolfOrderDetail message. Does not implicitly {@link TechwolfOrderDetail.verify|verify} messages.
     * @function encode
     * @memberof TechwolfOrderDetail
     * @static
     * @param {ITechwolfOrderDetail} message TechwolfOrderDetail message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfOrderDetail.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.subTitle);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.url);
        if (message.orderDetailEntryList != null && message.orderDetailEntryList.length)
            for (let i = 0; i < message.orderDetailEntryList.length; ++i)
                $root.TechwolfOrderDetailEntry.encode(message.orderDetailEntryList[i], writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfOrderDetail message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfOrderDetail
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfOrderDetail} TechwolfOrderDetail
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfOrderDetail.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfOrderDetail();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    message.subTitle = reader.string();
                    break;
                }
            case 3: {
                    message.url = reader.string();
                    break;
                }
            case 4: {
                    if (!(message.orderDetailEntryList && message.orderDetailEntryList.length))
                        message.orderDetailEntryList = [];
                    message.orderDetailEntryList.push($root.TechwolfOrderDetailEntry.decode(reader, reader.uint32()));
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("title"))
            throw $util.ProtocolError("missing required 'title'", { instance: message });
        if (!message.hasOwnProperty("subTitle"))
            throw $util.ProtocolError("missing required 'subTitle'", { instance: message });
        return message;
    };

    return TechwolfOrderDetail;
})();

export const TechwolfOrderDetailItem = $root.TechwolfOrderDetailItem = (() => {

    /**
     * Properties of a TechwolfOrderDetailItem.
     * @exports ITechwolfOrderDetailItem
     * @interface ITechwolfOrderDetailItem
     * @property {string} name TechwolfOrderDetailItem name
     * @property {number} templateId TechwolfOrderDetailItem templateId
     */

    /**
     * Constructs a new TechwolfOrderDetailItem.
     * @exports TechwolfOrderDetailItem
     * @classdesc Represents a TechwolfOrderDetailItem.
     * @implements ITechwolfOrderDetailItem
     * @constructor
     * @param {ITechwolfOrderDetailItem=} [properties] Properties to set
     */
    function TechwolfOrderDetailItem(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfOrderDetailItem name.
     * @member {string} name
     * @memberof TechwolfOrderDetailItem
     * @instance
     */
    TechwolfOrderDetailItem.prototype.name = "";

    /**
     * TechwolfOrderDetailItem templateId.
     * @member {number} templateId
     * @memberof TechwolfOrderDetailItem
     * @instance
     */
    TechwolfOrderDetailItem.prototype.templateId = 0;

    /**
     * Creates a new TechwolfOrderDetailItem instance using the specified properties.
     * @function create
     * @memberof TechwolfOrderDetailItem
     * @static
     * @param {ITechwolfOrderDetailItem=} [properties] Properties to set
     * @returns {TechwolfOrderDetailItem} TechwolfOrderDetailItem instance
     */
    TechwolfOrderDetailItem.create = function create(properties) {
        return new TechwolfOrderDetailItem(properties);
    };

    /**
     * Encodes the specified TechwolfOrderDetailItem message. Does not implicitly {@link TechwolfOrderDetailItem.verify|verify} messages.
     * @function encode
     * @memberof TechwolfOrderDetailItem
     * @static
     * @param {ITechwolfOrderDetailItem} message TechwolfOrderDetailItem message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfOrderDetailItem.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.name);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.templateId);
        return writer;
    };

    /**
     * Decodes a TechwolfOrderDetailItem message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfOrderDetailItem
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfOrderDetailItem} TechwolfOrderDetailItem
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfOrderDetailItem.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfOrderDetailItem();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.name = reader.string();
                    break;
                }
            case 2: {
                    message.templateId = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("name"))
            throw $util.ProtocolError("missing required 'name'", { instance: message });
        if (!message.hasOwnProperty("templateId"))
            throw $util.ProtocolError("missing required 'templateId'", { instance: message });
        return message;
    };

    return TechwolfOrderDetailItem;
})();

export const TechwolfOrderDetailEntry = $root.TechwolfOrderDetailEntry = (() => {

    /**
     * Properties of a TechwolfOrderDetailEntry.
     * @exports ITechwolfOrderDetailEntry
     * @interface ITechwolfOrderDetailEntry
     * @property {ITechwolfOrderDetailItem} key TechwolfOrderDetailEntry key
     * @property {ITechwolfOrderDetailItem} value TechwolfOrderDetailEntry value
     */

    /**
     * Constructs a new TechwolfOrderDetailEntry.
     * @exports TechwolfOrderDetailEntry
     * @classdesc Represents a TechwolfOrderDetailEntry.
     * @implements ITechwolfOrderDetailEntry
     * @constructor
     * @param {ITechwolfOrderDetailEntry=} [properties] Properties to set
     */
    function TechwolfOrderDetailEntry(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfOrderDetailEntry key.
     * @member {ITechwolfOrderDetailItem} key
     * @memberof TechwolfOrderDetailEntry
     * @instance
     */
    TechwolfOrderDetailEntry.prototype.key = null;

    /**
     * TechwolfOrderDetailEntry value.
     * @member {ITechwolfOrderDetailItem} value
     * @memberof TechwolfOrderDetailEntry
     * @instance
     */
    TechwolfOrderDetailEntry.prototype.value = null;

    /**
     * Creates a new TechwolfOrderDetailEntry instance using the specified properties.
     * @function create
     * @memberof TechwolfOrderDetailEntry
     * @static
     * @param {ITechwolfOrderDetailEntry=} [properties] Properties to set
     * @returns {TechwolfOrderDetailEntry} TechwolfOrderDetailEntry instance
     */
    TechwolfOrderDetailEntry.create = function create(properties) {
        return new TechwolfOrderDetailEntry(properties);
    };

    /**
     * Encodes the specified TechwolfOrderDetailEntry message. Does not implicitly {@link TechwolfOrderDetailEntry.verify|verify} messages.
     * @function encode
     * @memberof TechwolfOrderDetailEntry
     * @static
     * @param {ITechwolfOrderDetailEntry} message TechwolfOrderDetailEntry message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfOrderDetailEntry.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        $root.TechwolfOrderDetailItem.encode(message.key, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        $root.TechwolfOrderDetailItem.encode(message.value, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfOrderDetailEntry message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfOrderDetailEntry
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfOrderDetailEntry} TechwolfOrderDetailEntry
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfOrderDetailEntry.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfOrderDetailEntry();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.key = $root.TechwolfOrderDetailItem.decode(reader, reader.uint32());
                    break;
                }
            case 2: {
                    message.value = $root.TechwolfOrderDetailItem.decode(reader, reader.uint32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("key"))
            throw $util.ProtocolError("missing required 'key'", { instance: message });
        if (!message.hasOwnProperty("value"))
            throw $util.ProtocolError("missing required 'value'", { instance: message });
        return message;
    };

    return TechwolfOrderDetailEntry;
})();

export const TechwolfUserSync = $root.TechwolfUserSync = (() => {

    /**
     * Properties of a TechwolfUserSync.
     * @exports ITechwolfUserSync
     * @interface ITechwolfUserSync
     * @property {Long} uid TechwolfUserSync uid
     * @property {number} identity TechwolfUserSync identity
     * @property {string|null} [extraJson] TechwolfUserSync extraJson
     * @property {number|null} [userSource] TechwolfUserSync userSource
     */

    /**
     * Constructs a new TechwolfUserSync.
     * @exports TechwolfUserSync
     * @classdesc Represents a TechwolfUserSync.
     * @implements ITechwolfUserSync
     * @constructor
     * @param {ITechwolfUserSync=} [properties] Properties to set
     */
    function TechwolfUserSync(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfUserSync uid.
     * @member {Long} uid
     * @memberof TechwolfUserSync
     * @instance
     */
    TechwolfUserSync.prototype.uid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfUserSync identity.
     * @member {number} identity
     * @memberof TechwolfUserSync
     * @instance
     */
    TechwolfUserSync.prototype.identity = 0;

    /**
     * TechwolfUserSync extraJson.
     * @member {string} extraJson
     * @memberof TechwolfUserSync
     * @instance
     */
    TechwolfUserSync.prototype.extraJson = "";

    /**
     * TechwolfUserSync userSource.
     * @member {number} userSource
     * @memberof TechwolfUserSync
     * @instance
     */
    TechwolfUserSync.prototype.userSource = 0;

    /**
     * Creates a new TechwolfUserSync instance using the specified properties.
     * @function create
     * @memberof TechwolfUserSync
     * @static
     * @param {ITechwolfUserSync=} [properties] Properties to set
     * @returns {TechwolfUserSync} TechwolfUserSync instance
     */
    TechwolfUserSync.create = function create(properties) {
        return new TechwolfUserSync(properties);
    };

    /**
     * Encodes the specified TechwolfUserSync message. Does not implicitly {@link TechwolfUserSync.verify|verify} messages.
     * @function encode
     * @memberof TechwolfUserSync
     * @static
     * @param {ITechwolfUserSync} message TechwolfUserSync message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfUserSync.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.uid);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.identity);
        if (message.extraJson != null && Object.hasOwnProperty.call(message, "extraJson"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.extraJson);
        if (message.userSource != null && Object.hasOwnProperty.call(message, "userSource"))
            writer.uint32(/* id 4, wireType 0 =*/32).int32(message.userSource);
        return writer;
    };

    /**
     * Decodes a TechwolfUserSync message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfUserSync
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfUserSync} TechwolfUserSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfUserSync.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfUserSync();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.uid = reader.int64();
                    break;
                }
            case 2: {
                    message.identity = reader.int32();
                    break;
                }
            case 3: {
                    message.extraJson = reader.string();
                    break;
                }
            case 4: {
                    message.userSource = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("uid"))
            throw $util.ProtocolError("missing required 'uid'", { instance: message });
        if (!message.hasOwnProperty("identity"))
            throw $util.ProtocolError("missing required 'identity'", { instance: message });
        return message;
    };

    return TechwolfUserSync;
})();

export const TechwolfDataSync = $root.TechwolfDataSync = (() => {

    /**
     * Properties of a TechwolfDataSync.
     * @exports ITechwolfDataSync
     * @interface ITechwolfDataSync
     * @property {number} type TechwolfDataSync type
     * @property {ITechwolfUserSync|null} [userSync] TechwolfDataSync userSync
     * @property {ITechwolfGroupSync|null} [groupSync] TechwolfDataSync groupSync
     */

    /**
     * Constructs a new TechwolfDataSync.
     * @exports TechwolfDataSync
     * @classdesc Represents a TechwolfDataSync.
     * @implements ITechwolfDataSync
     * @constructor
     * @param {ITechwolfDataSync=} [properties] Properties to set
     */
    function TechwolfDataSync(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfDataSync type.
     * @member {number} type
     * @memberof TechwolfDataSync
     * @instance
     */
    TechwolfDataSync.prototype.type = 0;

    /**
     * TechwolfDataSync userSync.
     * @member {ITechwolfUserSync|null|undefined} userSync
     * @memberof TechwolfDataSync
     * @instance
     */
    TechwolfDataSync.prototype.userSync = null;

    /**
     * TechwolfDataSync groupSync.
     * @member {ITechwolfGroupSync|null|undefined} groupSync
     * @memberof TechwolfDataSync
     * @instance
     */
    TechwolfDataSync.prototype.groupSync = null;

    /**
     * Creates a new TechwolfDataSync instance using the specified properties.
     * @function create
     * @memberof TechwolfDataSync
     * @static
     * @param {ITechwolfDataSync=} [properties] Properties to set
     * @returns {TechwolfDataSync} TechwolfDataSync instance
     */
    TechwolfDataSync.create = function create(properties) {
        return new TechwolfDataSync(properties);
    };

    /**
     * Encodes the specified TechwolfDataSync message. Does not implicitly {@link TechwolfDataSync.verify|verify} messages.
     * @function encode
     * @memberof TechwolfDataSync
     * @static
     * @param {ITechwolfDataSync} message TechwolfDataSync message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfDataSync.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
        if (message.userSync != null && Object.hasOwnProperty.call(message, "userSync"))
            $root.TechwolfUserSync.encode(message.userSync, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        if (message.groupSync != null && Object.hasOwnProperty.call(message, "groupSync"))
            $root.TechwolfGroupSync.encode(message.groupSync, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfDataSync message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfDataSync
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfDataSync} TechwolfDataSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfDataSync.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfDataSync();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.type = reader.int32();
                    break;
                }
            case 2: {
                    message.userSync = $root.TechwolfUserSync.decode(reader, reader.uint32());
                    break;
                }
            case 3: {
                    message.groupSync = $root.TechwolfGroupSync.decode(reader, reader.uint32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        return message;
    };

    return TechwolfDataSync;
})();

export const TechwolfSlice = $root.TechwolfSlice = (() => {

    /**
     * Properties of a TechwolfSlice.
     * @exports ITechwolfSlice
     * @interface ITechwolfSlice
     * @property {number} startIndex TechwolfSlice startIndex
     * @property {number} endIndex TechwolfSlice endIndex
     */

    /**
     * Constructs a new TechwolfSlice.
     * @exports TechwolfSlice
     * @classdesc Represents a TechwolfSlice.
     * @implements ITechwolfSlice
     * @constructor
     * @param {ITechwolfSlice=} [properties] Properties to set
     */
    function TechwolfSlice(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfSlice startIndex.
     * @member {number} startIndex
     * @memberof TechwolfSlice
     * @instance
     */
    TechwolfSlice.prototype.startIndex = 0;

    /**
     * TechwolfSlice endIndex.
     * @member {number} endIndex
     * @memberof TechwolfSlice
     * @instance
     */
    TechwolfSlice.prototype.endIndex = 0;

    /**
     * Creates a new TechwolfSlice instance using the specified properties.
     * @function create
     * @memberof TechwolfSlice
     * @static
     * @param {ITechwolfSlice=} [properties] Properties to set
     * @returns {TechwolfSlice} TechwolfSlice instance
     */
    TechwolfSlice.create = function create(properties) {
        return new TechwolfSlice(properties);
    };

    /**
     * Encodes the specified TechwolfSlice message. Does not implicitly {@link TechwolfSlice.verify|verify} messages.
     * @function encode
     * @memberof TechwolfSlice
     * @static
     * @param {ITechwolfSlice} message TechwolfSlice message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfSlice.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.startIndex);
        writer.uint32(/* id 2, wireType 0 =*/16).int32(message.endIndex);
        return writer;
    };

    /**
     * Decodes a TechwolfSlice message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfSlice
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfSlice} TechwolfSlice
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfSlice.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfSlice();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.startIndex = reader.int32();
                    break;
                }
            case 2: {
                    message.endIndex = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("startIndex"))
            throw $util.ProtocolError("missing required 'startIndex'", { instance: message });
        if (!message.hasOwnProperty("endIndex"))
            throw $util.ProtocolError("missing required 'endIndex'", { instance: message });
        return message;
    };

    return TechwolfSlice;
})();

export const UserExperience = $root.UserExperience = (() => {

    /**
     * Properties of a UserExperience.
     * @exports IUserExperience
     * @interface IUserExperience
     * @property {string} organization UserExperience organization
     * @property {string} occupation UserExperience occupation
     * @property {string|null} [startDate] UserExperience startDate
     * @property {string|null} [endDate] UserExperience endDate
     * @property {number} type UserExperience type
     */

    /**
     * Constructs a new UserExperience.
     * @exports UserExperience
     * @classdesc Represents a UserExperience.
     * @implements IUserExperience
     * @constructor
     * @param {IUserExperience=} [properties] Properties to set
     */
    function UserExperience(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * UserExperience organization.
     * @member {string} organization
     * @memberof UserExperience
     * @instance
     */
    UserExperience.prototype.organization = "";

    /**
     * UserExperience occupation.
     * @member {string} occupation
     * @memberof UserExperience
     * @instance
     */
    UserExperience.prototype.occupation = "";

    /**
     * UserExperience startDate.
     * @member {string} startDate
     * @memberof UserExperience
     * @instance
     */
    UserExperience.prototype.startDate = "";

    /**
     * UserExperience endDate.
     * @member {string} endDate
     * @memberof UserExperience
     * @instance
     */
    UserExperience.prototype.endDate = "";

    /**
     * UserExperience type.
     * @member {number} type
     * @memberof UserExperience
     * @instance
     */
    UserExperience.prototype.type = 0;

    /**
     * Creates a new UserExperience instance using the specified properties.
     * @function create
     * @memberof UserExperience
     * @static
     * @param {IUserExperience=} [properties] Properties to set
     * @returns {UserExperience} UserExperience instance
     */
    UserExperience.create = function create(properties) {
        return new UserExperience(properties);
    };

    /**
     * Encodes the specified UserExperience message. Does not implicitly {@link UserExperience.verify|verify} messages.
     * @function encode
     * @memberof UserExperience
     * @static
     * @param {IUserExperience} message UserExperience message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    UserExperience.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.organization);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.occupation);
        if (message.startDate != null && Object.hasOwnProperty.call(message, "startDate"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.startDate);
        if (message.endDate != null && Object.hasOwnProperty.call(message, "endDate"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.endDate);
        writer.uint32(/* id 5, wireType 0 =*/40).int32(message.type);
        return writer;
    };

    /**
     * Decodes a UserExperience message from the specified reader or buffer.
     * @function decode
     * @memberof UserExperience
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {UserExperience} UserExperience
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    UserExperience.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.UserExperience();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.organization = reader.string();
                    break;
                }
            case 2: {
                    message.occupation = reader.string();
                    break;
                }
            case 3: {
                    message.startDate = reader.string();
                    break;
                }
            case 4: {
                    message.endDate = reader.string();
                    break;
                }
            case 5: {
                    message.type = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("organization"))
            throw $util.ProtocolError("missing required 'organization'", { instance: message });
        if (!message.hasOwnProperty("occupation"))
            throw $util.ProtocolError("missing required 'occupation'", { instance: message });
        if (!message.hasOwnProperty("type"))
            throw $util.ProtocolError("missing required 'type'", { instance: message });
        return message;
    };

    return UserExperience;
})();

export const TechwolfJobShare = $root.TechwolfJobShare = (() => {

    /**
     * Properties of a TechwolfJobShare.
     * @exports ITechwolfJobShare
     * @interface ITechwolfJobShare
     * @property {ITechwolfUser} user TechwolfJobShare user
     * @property {Long} jobId TechwolfJobShare jobId
     * @property {string} position TechwolfJobShare position
     * @property {string} salary TechwolfJobShare salary
     * @property {string|null} [location] TechwolfJobShare location
     * @property {string} company TechwolfJobShare company
     * @property {string|null} [stage] TechwolfJobShare stage
     * @property {string|null} [experience] TechwolfJobShare experience
     * @property {string|null} [education] TechwolfJobShare education
     * @property {string|null} [url] TechwolfJobShare url
     * @property {string|null} [lid] TechwolfJobShare lid
     * @property {string|null} [price] TechwolfJobShare price
     * @property {string|null} [description] TechwolfJobShare description
     */

    /**
     * Constructs a new TechwolfJobShare.
     * @exports TechwolfJobShare
     * @classdesc Represents a TechwolfJobShare.
     * @implements ITechwolfJobShare
     * @constructor
     * @param {ITechwolfJobShare=} [properties] Properties to set
     */
    function TechwolfJobShare(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfJobShare user.
     * @member {ITechwolfUser} user
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.user = null;

    /**
     * TechwolfJobShare jobId.
     * @member {Long} jobId
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.jobId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfJobShare position.
     * @member {string} position
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.position = "";

    /**
     * TechwolfJobShare salary.
     * @member {string} salary
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.salary = "";

    /**
     * TechwolfJobShare location.
     * @member {string} location
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.location = "";

    /**
     * TechwolfJobShare company.
     * @member {string} company
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.company = "";

    /**
     * TechwolfJobShare stage.
     * @member {string} stage
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.stage = "";

    /**
     * TechwolfJobShare experience.
     * @member {string} experience
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.experience = "";

    /**
     * TechwolfJobShare education.
     * @member {string} education
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.education = "";

    /**
     * TechwolfJobShare url.
     * @member {string} url
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.url = "";

    /**
     * TechwolfJobShare lid.
     * @member {string} lid
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.lid = "";

    /**
     * TechwolfJobShare price.
     * @member {string} price
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.price = "";

    /**
     * TechwolfJobShare description.
     * @member {string} description
     * @memberof TechwolfJobShare
     * @instance
     */
    TechwolfJobShare.prototype.description = "";

    /**
     * Creates a new TechwolfJobShare instance using the specified properties.
     * @function create
     * @memberof TechwolfJobShare
     * @static
     * @param {ITechwolfJobShare=} [properties] Properties to set
     * @returns {TechwolfJobShare} TechwolfJobShare instance
     */
    TechwolfJobShare.create = function create(properties) {
        return new TechwolfJobShare(properties);
    };

    /**
     * Encodes the specified TechwolfJobShare message. Does not implicitly {@link TechwolfJobShare.verify|verify} messages.
     * @function encode
     * @memberof TechwolfJobShare
     * @static
     * @param {ITechwolfJobShare} message TechwolfJobShare message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfJobShare.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        $root.TechwolfUser.encode(message.user, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.jobId);
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.position);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.salary);
        if (message.location != null && Object.hasOwnProperty.call(message, "location"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.location);
        writer.uint32(/* id 6, wireType 2 =*/50).string(message.company);
        if (message.stage != null && Object.hasOwnProperty.call(message, "stage"))
            writer.uint32(/* id 7, wireType 2 =*/58).string(message.stage);
        if (message.experience != null && Object.hasOwnProperty.call(message, "experience"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.experience);
        if (message.education != null && Object.hasOwnProperty.call(message, "education"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.education);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.url);
        if (message.lid != null && Object.hasOwnProperty.call(message, "lid"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.lid);
        if (message.price != null && Object.hasOwnProperty.call(message, "price"))
            writer.uint32(/* id 12, wireType 2 =*/98).string(message.price);
        if (message.description != null && Object.hasOwnProperty.call(message, "description"))
            writer.uint32(/* id 13, wireType 2 =*/106).string(message.description);
        return writer;
    };

    /**
     * Decodes a TechwolfJobShare message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfJobShare
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfJobShare} TechwolfJobShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfJobShare.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfJobShare();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.user = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 2: {
                    message.jobId = reader.int64();
                    break;
                }
            case 3: {
                    message.position = reader.string();
                    break;
                }
            case 4: {
                    message.salary = reader.string();
                    break;
                }
            case 5: {
                    message.location = reader.string();
                    break;
                }
            case 6: {
                    message.company = reader.string();
                    break;
                }
            case 7: {
                    message.stage = reader.string();
                    break;
                }
            case 8: {
                    message.experience = reader.string();
                    break;
                }
            case 9: {
                    message.education = reader.string();
                    break;
                }
            case 10: {
                    message.url = reader.string();
                    break;
                }
            case 11: {
                    message.lid = reader.string();
                    break;
                }
            case 12: {
                    message.price = reader.string();
                    break;
                }
            case 13: {
                    message.description = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("user"))
            throw $util.ProtocolError("missing required 'user'", { instance: message });
        if (!message.hasOwnProperty("jobId"))
            throw $util.ProtocolError("missing required 'jobId'", { instance: message });
        if (!message.hasOwnProperty("position"))
            throw $util.ProtocolError("missing required 'position'", { instance: message });
        if (!message.hasOwnProperty("salary"))
            throw $util.ProtocolError("missing required 'salary'", { instance: message });
        if (!message.hasOwnProperty("company"))
            throw $util.ProtocolError("missing required 'company'", { instance: message });
        return message;
    };

    return TechwolfJobShare;
})();

export const TechwolfResumeShare = $root.TechwolfResumeShare = (() => {

    /**
     * Properties of a TechwolfResumeShare.
     * @exports ITechwolfResumeShare
     * @interface ITechwolfResumeShare
     * @property {ITechwolfUser} user TechwolfResumeShare user
     * @property {Long} expectId TechwolfResumeShare expectId
     * @property {string} position TechwolfResumeShare position
     * @property {string} salary TechwolfResumeShare salary
     * @property {string|null} [location] TechwolfResumeShare location
     * @property {string|null} [applyStatus] TechwolfResumeShare applyStatus
     * @property {string|null} [age] TechwolfResumeShare age
     * @property {string|null} [experience] TechwolfResumeShare experience
     * @property {string|null} [education] TechwolfResumeShare education
     * @property {string|null} [url] TechwolfResumeShare url
     * @property {string|null} [lid] TechwolfResumeShare lid
     * @property {number|null} [gender] TechwolfResumeShare gender
     * @property {boolean|null} [blurred] TechwolfResumeShare blurred
     * @property {number|null} [source] TechwolfResumeShare source
     */

    /**
     * Constructs a new TechwolfResumeShare.
     * @exports TechwolfResumeShare
     * @classdesc Represents a TechwolfResumeShare.
     * @implements ITechwolfResumeShare
     * @constructor
     * @param {ITechwolfResumeShare=} [properties] Properties to set
     */
    function TechwolfResumeShare(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfResumeShare user.
     * @member {ITechwolfUser} user
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.user = null;

    /**
     * TechwolfResumeShare expectId.
     * @member {Long} expectId
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.expectId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfResumeShare position.
     * @member {string} position
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.position = "";

    /**
     * TechwolfResumeShare salary.
     * @member {string} salary
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.salary = "";

    /**
     * TechwolfResumeShare location.
     * @member {string} location
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.location = "";

    /**
     * TechwolfResumeShare applyStatus.
     * @member {string} applyStatus
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.applyStatus = "";

    /**
     * TechwolfResumeShare age.
     * @member {string} age
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.age = "";

    /**
     * TechwolfResumeShare experience.
     * @member {string} experience
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.experience = "";

    /**
     * TechwolfResumeShare education.
     * @member {string} education
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.education = "";

    /**
     * TechwolfResumeShare url.
     * @member {string} url
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.url = "";

    /**
     * TechwolfResumeShare lid.
     * @member {string} lid
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.lid = "";

    /**
     * TechwolfResumeShare gender.
     * @member {number} gender
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.gender = 0;

    /**
     * TechwolfResumeShare blurred.
     * @member {boolean} blurred
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.blurred = false;

    /**
     * TechwolfResumeShare source.
     * @member {number} source
     * @memberof TechwolfResumeShare
     * @instance
     */
    TechwolfResumeShare.prototype.source = 0;

    /**
     * Creates a new TechwolfResumeShare instance using the specified properties.
     * @function create
     * @memberof TechwolfResumeShare
     * @static
     * @param {ITechwolfResumeShare=} [properties] Properties to set
     * @returns {TechwolfResumeShare} TechwolfResumeShare instance
     */
    TechwolfResumeShare.create = function create(properties) {
        return new TechwolfResumeShare(properties);
    };

    /**
     * Encodes the specified TechwolfResumeShare message. Does not implicitly {@link TechwolfResumeShare.verify|verify} messages.
     * @function encode
     * @memberof TechwolfResumeShare
     * @static
     * @param {ITechwolfResumeShare} message TechwolfResumeShare message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfResumeShare.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        $root.TechwolfUser.encode(message.user, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        writer.uint32(/* id 2, wireType 0 =*/16).int64(message.expectId);
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.position);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.salary);
        if (message.location != null && Object.hasOwnProperty.call(message, "location"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.location);
        if (message.applyStatus != null && Object.hasOwnProperty.call(message, "applyStatus"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.applyStatus);
        if (message.age != null && Object.hasOwnProperty.call(message, "age"))
            writer.uint32(/* id 7, wireType 2 =*/58).string(message.age);
        if (message.experience != null && Object.hasOwnProperty.call(message, "experience"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.experience);
        if (message.education != null && Object.hasOwnProperty.call(message, "education"))
            writer.uint32(/* id 9, wireType 2 =*/74).string(message.education);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 10, wireType 2 =*/82).string(message.url);
        if (message.lid != null && Object.hasOwnProperty.call(message, "lid"))
            writer.uint32(/* id 11, wireType 2 =*/90).string(message.lid);
        if (message.gender != null && Object.hasOwnProperty.call(message, "gender"))
            writer.uint32(/* id 12, wireType 0 =*/96).int32(message.gender);
        if (message.blurred != null && Object.hasOwnProperty.call(message, "blurred"))
            writer.uint32(/* id 13, wireType 0 =*/104).bool(message.blurred);
        if (message.source != null && Object.hasOwnProperty.call(message, "source"))
            writer.uint32(/* id 14, wireType 0 =*/112).int32(message.source);
        return writer;
    };

    /**
     * Decodes a TechwolfResumeShare message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfResumeShare
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfResumeShare} TechwolfResumeShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfResumeShare.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfResumeShare();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.user = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 2: {
                    message.expectId = reader.int64();
                    break;
                }
            case 3: {
                    message.position = reader.string();
                    break;
                }
            case 4: {
                    message.salary = reader.string();
                    break;
                }
            case 5: {
                    message.location = reader.string();
                    break;
                }
            case 6: {
                    message.applyStatus = reader.string();
                    break;
                }
            case 7: {
                    message.age = reader.string();
                    break;
                }
            case 8: {
                    message.experience = reader.string();
                    break;
                }
            case 9: {
                    message.education = reader.string();
                    break;
                }
            case 10: {
                    message.url = reader.string();
                    break;
                }
            case 11: {
                    message.lid = reader.string();
                    break;
                }
            case 12: {
                    message.gender = reader.int32();
                    break;
                }
            case 13: {
                    message.blurred = reader.bool();
                    break;
                }
            case 14: {
                    message.source = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("user"))
            throw $util.ProtocolError("missing required 'user'", { instance: message });
        if (!message.hasOwnProperty("expectId"))
            throw $util.ProtocolError("missing required 'expectId'", { instance: message });
        if (!message.hasOwnProperty("position"))
            throw $util.ProtocolError("missing required 'position'", { instance: message });
        if (!message.hasOwnProperty("salary"))
            throw $util.ProtocolError("missing required 'salary'", { instance: message });
        return message;
    };

    return TechwolfResumeShare;
})();

export const AtInfo = $root.AtInfo = (() => {

    /**
     * Properties of an AtInfo.
     * @exports IAtInfo
     * @interface IAtInfo
     * @property {number} flag AtInfo flag
     * @property {Array.<Long>|null} [uids] AtInfo uids
     */

    /**
     * Constructs a new AtInfo.
     * @exports AtInfo
     * @classdesc Represents an AtInfo.
     * @implements IAtInfo
     * @constructor
     * @param {IAtInfo=} [properties] Properties to set
     */
    function AtInfo(properties) {
        this.uids = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * AtInfo flag.
     * @member {number} flag
     * @memberof AtInfo
     * @instance
     */
    AtInfo.prototype.flag = 0;

    /**
     * AtInfo uids.
     * @member {Array.<Long>} uids
     * @memberof AtInfo
     * @instance
     */
    AtInfo.prototype.uids = $util.emptyArray;

    /**
     * Creates a new AtInfo instance using the specified properties.
     * @function create
     * @memberof AtInfo
     * @static
     * @param {IAtInfo=} [properties] Properties to set
     * @returns {AtInfo} AtInfo instance
     */
    AtInfo.create = function create(properties) {
        return new AtInfo(properties);
    };

    /**
     * Encodes the specified AtInfo message. Does not implicitly {@link AtInfo.verify|verify} messages.
     * @function encode
     * @memberof AtInfo
     * @static
     * @param {IAtInfo} message AtInfo message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    AtInfo.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int32(message.flag);
        if (message.uids != null && message.uids.length)
            for (let i = 0; i < message.uids.length; ++i)
                writer.uint32(/* id 2, wireType 0 =*/16).int64(message.uids[i]);
        return writer;
    };

    /**
     * Decodes an AtInfo message from the specified reader or buffer.
     * @function decode
     * @memberof AtInfo
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {AtInfo} AtInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    AtInfo.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.AtInfo();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.flag = reader.int32();
                    break;
                }
            case 2: {
                    if (!(message.uids && message.uids.length))
                        message.uids = [];
                    if ((tag & 7) === 2) {
                        let end2 = reader.uint32() + reader.pos;
                        while (reader.pos < end2)
                            message.uids.push(reader.int64());
                    } else
                        message.uids.push(reader.int64());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("flag"))
            throw $util.ProtocolError("missing required 'flag'", { instance: message });
        return message;
    };

    return AtInfo;
})();

export const TechwolfGroupSync = $root.TechwolfGroupSync = (() => {

    /**
     * Properties of a TechwolfGroupSync.
     * @exports ITechwolfGroupSync
     * @interface ITechwolfGroupSync
     * @property {Long} gid TechwolfGroupSync gid
     * @property {number|null} [version] TechwolfGroupSync version
     * @property {string|null} [encGid] TechwolfGroupSync encGid
     */

    /**
     * Constructs a new TechwolfGroupSync.
     * @exports TechwolfGroupSync
     * @classdesc Represents a TechwolfGroupSync.
     * @implements ITechwolfGroupSync
     * @constructor
     * @param {ITechwolfGroupSync=} [properties] Properties to set
     */
    function TechwolfGroupSync(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfGroupSync gid.
     * @member {Long} gid
     * @memberof TechwolfGroupSync
     * @instance
     */
    TechwolfGroupSync.prototype.gid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfGroupSync version.
     * @member {number} version
     * @memberof TechwolfGroupSync
     * @instance
     */
    TechwolfGroupSync.prototype.version = 0;

    /**
     * TechwolfGroupSync encGid.
     * @member {string} encGid
     * @memberof TechwolfGroupSync
     * @instance
     */
    TechwolfGroupSync.prototype.encGid = "";

    /**
     * Creates a new TechwolfGroupSync instance using the specified properties.
     * @function create
     * @memberof TechwolfGroupSync
     * @static
     * @param {ITechwolfGroupSync=} [properties] Properties to set
     * @returns {TechwolfGroupSync} TechwolfGroupSync instance
     */
    TechwolfGroupSync.create = function create(properties) {
        return new TechwolfGroupSync(properties);
    };

    /**
     * Encodes the specified TechwolfGroupSync message. Does not implicitly {@link TechwolfGroupSync.verify|verify} messages.
     * @function encode
     * @memberof TechwolfGroupSync
     * @static
     * @param {ITechwolfGroupSync} message TechwolfGroupSync message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfGroupSync.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.gid);
        if (message.version != null && Object.hasOwnProperty.call(message, "version"))
            writer.uint32(/* id 2, wireType 0 =*/16).int32(message.version);
        if (message.encGid != null && Object.hasOwnProperty.call(message, "encGid"))
            writer.uint32(/* id 3, wireType 2 =*/26).string(message.encGid);
        return writer;
    };

    /**
     * Decodes a TechwolfGroupSync message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfGroupSync
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfGroupSync} TechwolfGroupSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfGroupSync.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfGroupSync();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.gid = reader.int64();
                    break;
                }
            case 2: {
                    message.version = reader.int32();
                    break;
                }
            case 3: {
                    message.encGid = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("gid"))
            throw $util.ProtocolError("missing required 'gid'", { instance: message });
        return message;
    };

    return TechwolfGroupSync;
})();

export const TechwolfSticker = $root.TechwolfSticker = (() => {

    /**
     * Properties of a TechwolfSticker.
     * @exports ITechwolfSticker
     * @interface ITechwolfSticker
     * @property {Long} sid TechwolfSticker sid
     * @property {Long|null} [packId] TechwolfSticker packId
     * @property {ITechwolfImage|null} [image] TechwolfSticker image
     * @property {string|null} [format] TechwolfSticker format
     * @property {string|null} [name] TechwolfSticker name
     */

    /**
     * Constructs a new TechwolfSticker.
     * @exports TechwolfSticker
     * @classdesc Represents a TechwolfSticker.
     * @implements ITechwolfSticker
     * @constructor
     * @param {ITechwolfSticker=} [properties] Properties to set
     */
    function TechwolfSticker(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfSticker sid.
     * @member {Long} sid
     * @memberof TechwolfSticker
     * @instance
     */
    TechwolfSticker.prototype.sid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfSticker packId.
     * @member {Long} packId
     * @memberof TechwolfSticker
     * @instance
     */
    TechwolfSticker.prototype.packId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfSticker image.
     * @member {ITechwolfImage|null|undefined} image
     * @memberof TechwolfSticker
     * @instance
     */
    TechwolfSticker.prototype.image = null;

    /**
     * TechwolfSticker format.
     * @member {string} format
     * @memberof TechwolfSticker
     * @instance
     */
    TechwolfSticker.prototype.format = "";

    /**
     * TechwolfSticker name.
     * @member {string} name
     * @memberof TechwolfSticker
     * @instance
     */
    TechwolfSticker.prototype.name = "";

    /**
     * Creates a new TechwolfSticker instance using the specified properties.
     * @function create
     * @memberof TechwolfSticker
     * @static
     * @param {ITechwolfSticker=} [properties] Properties to set
     * @returns {TechwolfSticker} TechwolfSticker instance
     */
    TechwolfSticker.create = function create(properties) {
        return new TechwolfSticker(properties);
    };

    /**
     * Encodes the specified TechwolfSticker message. Does not implicitly {@link TechwolfSticker.verify|verify} messages.
     * @function encode
     * @memberof TechwolfSticker
     * @static
     * @param {ITechwolfSticker} message TechwolfSticker message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfSticker.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.sid);
        if (message.packId != null && Object.hasOwnProperty.call(message, "packId"))
            writer.uint32(/* id 2, wireType 0 =*/16).int64(message.packId);
        if (message.image != null && Object.hasOwnProperty.call(message, "image"))
            $root.TechwolfImage.encode(message.image, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        if (message.format != null && Object.hasOwnProperty.call(message, "format"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.format);
        if (message.name != null && Object.hasOwnProperty.call(message, "name"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.name);
        return writer;
    };

    /**
     * Decodes a TechwolfSticker message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfSticker
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfSticker} TechwolfSticker
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfSticker.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfSticker();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.sid = reader.int64();
                    break;
                }
            case 2: {
                    message.packId = reader.int64();
                    break;
                }
            case 3: {
                    message.image = $root.TechwolfImage.decode(reader, reader.uint32());
                    break;
                }
            case 4: {
                    message.format = reader.string();
                    break;
                }
            case 5: {
                    message.name = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("sid"))
            throw $util.ProtocolError("missing required 'sid'", { instance: message });
        return message;
    };

    return TechwolfSticker;
})();

export const TechwolfChatShare = $root.TechwolfChatShare = (() => {

    /**
     * Properties of a TechwolfChatShare.
     * @exports ITechwolfChatShare
     * @interface ITechwolfChatShare
     * @property {Long} shareId TechwolfChatShare shareId
     * @property {string} title TechwolfChatShare title
     * @property {Array.<string>|null} [records] TechwolfChatShare records
     * @property {string|null} [bottomText] TechwolfChatShare bottomText
     * @property {string|null} [url] TechwolfChatShare url
     * @property {ITechwolfUser} from TechwolfChatShare from
     * @property {ITechwolfUser} to TechwolfChatShare to
     * @property {ITechwolfUser} user TechwolfChatShare user
     */

    /**
     * Constructs a new TechwolfChatShare.
     * @exports TechwolfChatShare
     * @classdesc Represents a TechwolfChatShare.
     * @implements ITechwolfChatShare
     * @constructor
     * @param {ITechwolfChatShare=} [properties] Properties to set
     */
    function TechwolfChatShare(properties) {
        this.records = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfChatShare shareId.
     * @member {Long} shareId
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.shareId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfChatShare title.
     * @member {string} title
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.title = "";

    /**
     * TechwolfChatShare records.
     * @member {Array.<string>} records
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.records = $util.emptyArray;

    /**
     * TechwolfChatShare bottomText.
     * @member {string} bottomText
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.bottomText = "";

    /**
     * TechwolfChatShare url.
     * @member {string} url
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.url = "";

    /**
     * TechwolfChatShare from.
     * @member {ITechwolfUser} from
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.from = null;

    /**
     * TechwolfChatShare to.
     * @member {ITechwolfUser} to
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.to = null;

    /**
     * TechwolfChatShare user.
     * @member {ITechwolfUser} user
     * @memberof TechwolfChatShare
     * @instance
     */
    TechwolfChatShare.prototype.user = null;

    /**
     * Creates a new TechwolfChatShare instance using the specified properties.
     * @function create
     * @memberof TechwolfChatShare
     * @static
     * @param {ITechwolfChatShare=} [properties] Properties to set
     * @returns {TechwolfChatShare} TechwolfChatShare instance
     */
    TechwolfChatShare.create = function create(properties) {
        return new TechwolfChatShare(properties);
    };

    /**
     * Encodes the specified TechwolfChatShare message. Does not implicitly {@link TechwolfChatShare.verify|verify} messages.
     * @function encode
     * @memberof TechwolfChatShare
     * @static
     * @param {ITechwolfChatShare} message TechwolfChatShare message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfChatShare.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.shareId);
        writer.uint32(/* id 2, wireType 2 =*/18).string(message.title);
        if (message.records != null && message.records.length)
            for (let i = 0; i < message.records.length; ++i)
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.records[i]);
        if (message.bottomText != null && Object.hasOwnProperty.call(message, "bottomText"))
            writer.uint32(/* id 4, wireType 2 =*/34).string(message.bottomText);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.url);
        $root.TechwolfUser.encode(message.from, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
        $root.TechwolfUser.encode(message.to, writer.uint32(/* id 7, wireType 2 =*/58).fork()).ldelim();
        $root.TechwolfUser.encode(message.user, writer.uint32(/* id 8, wireType 2 =*/66).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfChatShare message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfChatShare
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfChatShare} TechwolfChatShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfChatShare.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfChatShare();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.shareId = reader.int64();
                    break;
                }
            case 2: {
                    message.title = reader.string();
                    break;
                }
            case 3: {
                    if (!(message.records && message.records.length))
                        message.records = [];
                    message.records.push(reader.string());
                    break;
                }
            case 4: {
                    message.bottomText = reader.string();
                    break;
                }
            case 5: {
                    message.url = reader.string();
                    break;
                }
            case 6: {
                    message.from = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 7: {
                    message.to = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 8: {
                    message.user = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("shareId"))
            throw $util.ProtocolError("missing required 'shareId'", { instance: message });
        if (!message.hasOwnProperty("title"))
            throw $util.ProtocolError("missing required 'title'", { instance: message });
        if (!message.hasOwnProperty("from"))
            throw $util.ProtocolError("missing required 'from'", { instance: message });
        if (!message.hasOwnProperty("to"))
            throw $util.ProtocolError("missing required 'to'", { instance: message });
        if (!message.hasOwnProperty("user"))
            throw $util.ProtocolError("missing required 'user'", { instance: message });
        return message;
    };

    return TechwolfChatShare;
})();

export const TechwolfInterviewShare = $root.TechwolfInterviewShare = (() => {

    /**
     * Properties of a TechwolfInterviewShare.
     * @exports ITechwolfInterviewShare
     * @interface ITechwolfInterviewShare
     * @property {Long} interviewId TechwolfInterviewShare interviewId
     * @property {ITechwolfUser} user TechwolfInterviewShare user
     * @property {string} title TechwolfInterviewShare title
     * @property {string} bottomText TechwolfInterviewShare bottomText
     * @property {string|null} [url] TechwolfInterviewShare url
     * @property {string|null} [interviewTime] TechwolfInterviewShare interviewTime
     * @property {string|null} [interviewAddress] TechwolfInterviewShare interviewAddress
     * @property {string|null} [jobName] TechwolfInterviewShare jobName
     */

    /**
     * Constructs a new TechwolfInterviewShare.
     * @exports TechwolfInterviewShare
     * @classdesc Represents a TechwolfInterviewShare.
     * @implements ITechwolfInterviewShare
     * @constructor
     * @param {ITechwolfInterviewShare=} [properties] Properties to set
     */
    function TechwolfInterviewShare(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfInterviewShare interviewId.
     * @member {Long} interviewId
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.interviewId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfInterviewShare user.
     * @member {ITechwolfUser} user
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.user = null;

    /**
     * TechwolfInterviewShare title.
     * @member {string} title
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.title = "";

    /**
     * TechwolfInterviewShare bottomText.
     * @member {string} bottomText
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.bottomText = "";

    /**
     * TechwolfInterviewShare url.
     * @member {string} url
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.url = "";

    /**
     * TechwolfInterviewShare interviewTime.
     * @member {string} interviewTime
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.interviewTime = "";

    /**
     * TechwolfInterviewShare interviewAddress.
     * @member {string} interviewAddress
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.interviewAddress = "";

    /**
     * TechwolfInterviewShare jobName.
     * @member {string} jobName
     * @memberof TechwolfInterviewShare
     * @instance
     */
    TechwolfInterviewShare.prototype.jobName = "";

    /**
     * Creates a new TechwolfInterviewShare instance using the specified properties.
     * @function create
     * @memberof TechwolfInterviewShare
     * @static
     * @param {ITechwolfInterviewShare=} [properties] Properties to set
     * @returns {TechwolfInterviewShare} TechwolfInterviewShare instance
     */
    TechwolfInterviewShare.create = function create(properties) {
        return new TechwolfInterviewShare(properties);
    };

    /**
     * Encodes the specified TechwolfInterviewShare message. Does not implicitly {@link TechwolfInterviewShare.verify|verify} messages.
     * @function encode
     * @memberof TechwolfInterviewShare
     * @static
     * @param {ITechwolfInterviewShare} message TechwolfInterviewShare message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfInterviewShare.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.interviewId);
        $root.TechwolfUser.encode(message.user, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        writer.uint32(/* id 3, wireType 2 =*/26).string(message.title);
        writer.uint32(/* id 4, wireType 2 =*/34).string(message.bottomText);
        if (message.url != null && Object.hasOwnProperty.call(message, "url"))
            writer.uint32(/* id 5, wireType 2 =*/42).string(message.url);
        if (message.interviewTime != null && Object.hasOwnProperty.call(message, "interviewTime"))
            writer.uint32(/* id 6, wireType 2 =*/50).string(message.interviewTime);
        if (message.interviewAddress != null && Object.hasOwnProperty.call(message, "interviewAddress"))
            writer.uint32(/* id 7, wireType 2 =*/58).string(message.interviewAddress);
        if (message.jobName != null && Object.hasOwnProperty.call(message, "jobName"))
            writer.uint32(/* id 8, wireType 2 =*/66).string(message.jobName);
        return writer;
    };

    /**
     * Decodes a TechwolfInterviewShare message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfInterviewShare
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfInterviewShare} TechwolfInterviewShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfInterviewShare.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfInterviewShare();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.interviewId = reader.int64();
                    break;
                }
            case 2: {
                    message.user = $root.TechwolfUser.decode(reader, reader.uint32());
                    break;
                }
            case 3: {
                    message.title = reader.string();
                    break;
                }
            case 4: {
                    message.bottomText = reader.string();
                    break;
                }
            case 5: {
                    message.url = reader.string();
                    break;
                }
            case 6: {
                    message.interviewTime = reader.string();
                    break;
                }
            case 7: {
                    message.interviewAddress = reader.string();
                    break;
                }
            case 8: {
                    message.jobName = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("interviewId"))
            throw $util.ProtocolError("missing required 'interviewId'", { instance: message });
        if (!message.hasOwnProperty("user"))
            throw $util.ProtocolError("missing required 'user'", { instance: message });
        if (!message.hasOwnProperty("title"))
            throw $util.ProtocolError("missing required 'title'", { instance: message });
        if (!message.hasOwnProperty("bottomText"))
            throw $util.ProtocolError("missing required 'bottomText'", { instance: message });
        return message;
    };

    return TechwolfInterviewShare;
})();

export const TechwolfListItem = $root.TechwolfListItem = (() => {

    /**
     * Properties of a TechwolfListItem.
     * @exports ITechwolfListItem
     * @interface ITechwolfListItem
     * @property {string|null} [title] TechwolfListItem title
     * @property {number|null} [icon] TechwolfListItem icon
     */

    /**
     * Constructs a new TechwolfListItem.
     * @exports TechwolfListItem
     * @classdesc Represents a TechwolfListItem.
     * @implements ITechwolfListItem
     * @constructor
     * @param {ITechwolfListItem=} [properties] Properties to set
     */
    function TechwolfListItem(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfListItem title.
     * @member {string} title
     * @memberof TechwolfListItem
     * @instance
     */
    TechwolfListItem.prototype.title = "";

    /**
     * TechwolfListItem icon.
     * @member {number} icon
     * @memberof TechwolfListItem
     * @instance
     */
    TechwolfListItem.prototype.icon = 0;

    /**
     * Creates a new TechwolfListItem instance using the specified properties.
     * @function create
     * @memberof TechwolfListItem
     * @static
     * @param {ITechwolfListItem=} [properties] Properties to set
     * @returns {TechwolfListItem} TechwolfListItem instance
     */
    TechwolfListItem.create = function create(properties) {
        return new TechwolfListItem(properties);
    };

    /**
     * Encodes the specified TechwolfListItem message. Does not implicitly {@link TechwolfListItem.verify|verify} messages.
     * @function encode
     * @memberof TechwolfListItem
     * @static
     * @param {ITechwolfListItem} message TechwolfListItem message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfListItem.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.title != null && Object.hasOwnProperty.call(message, "title"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        if (message.icon != null && Object.hasOwnProperty.call(message, "icon"))
            writer.uint32(/* id 2, wireType 0 =*/16).int32(message.icon);
        return writer;
    };

    /**
     * Decodes a TechwolfListItem message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfListItem
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfListItem} TechwolfListItem
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfListItem.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfListItem();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    message.icon = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfListItem;
})();

export const TechwolfListCard = $root.TechwolfListCard = (() => {

    /**
     * Properties of a TechwolfListCard.
     * @exports ITechwolfListCard
     * @interface ITechwolfListCard
     * @property {string|null} [title] TechwolfListCard title
     * @property {Array.<ITechwolfListItem>|null} [items] TechwolfListCard items
     * @property {number|null} [pageSize] TechwolfListCard pageSize
     */

    /**
     * Constructs a new TechwolfListCard.
     * @exports TechwolfListCard
     * @classdesc Represents a TechwolfListCard.
     * @implements ITechwolfListCard
     * @constructor
     * @param {ITechwolfListCard=} [properties] Properties to set
     */
    function TechwolfListCard(properties) {
        this.items = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfListCard title.
     * @member {string} title
     * @memberof TechwolfListCard
     * @instance
     */
    TechwolfListCard.prototype.title = "";

    /**
     * TechwolfListCard items.
     * @member {Array.<ITechwolfListItem>} items
     * @memberof TechwolfListCard
     * @instance
     */
    TechwolfListCard.prototype.items = $util.emptyArray;

    /**
     * TechwolfListCard pageSize.
     * @member {number} pageSize
     * @memberof TechwolfListCard
     * @instance
     */
    TechwolfListCard.prototype.pageSize = 0;

    /**
     * Creates a new TechwolfListCard instance using the specified properties.
     * @function create
     * @memberof TechwolfListCard
     * @static
     * @param {ITechwolfListCard=} [properties] Properties to set
     * @returns {TechwolfListCard} TechwolfListCard instance
     */
    TechwolfListCard.create = function create(properties) {
        return new TechwolfListCard(properties);
    };

    /**
     * Encodes the specified TechwolfListCard message. Does not implicitly {@link TechwolfListCard.verify|verify} messages.
     * @function encode
     * @memberof TechwolfListCard
     * @static
     * @param {ITechwolfListCard} message TechwolfListCard message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfListCard.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.title != null && Object.hasOwnProperty.call(message, "title"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        if (message.items != null && message.items.length)
            for (let i = 0; i < message.items.length; ++i)
                $root.TechwolfListItem.encode(message.items[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        if (message.pageSize != null && Object.hasOwnProperty.call(message, "pageSize"))
            writer.uint32(/* id 3, wireType 0 =*/24).int32(message.pageSize);
        return writer;
    };

    /**
     * Decodes a TechwolfListCard message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfListCard
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfListCard} TechwolfListCard
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfListCard.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfListCard();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    if (!(message.items && message.items.length))
                        message.items = [];
                    message.items.push($root.TechwolfListItem.decode(reader, reader.uint32()));
                    break;
                }
            case 3: {
                    message.pageSize = reader.int32();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfListCard;
})();

export const TechwolfStar = $root.TechwolfStar = (() => {

    /**
     * Properties of a TechwolfStar.
     * @exports ITechwolfStar
     * @interface ITechwolfStar
     * @property {Long} starId TechwolfStar starId
     * @property {string|null} [starDesc] TechwolfStar starDesc
     * @property {Array.<ITechwolfListItem>|null} [options] TechwolfStar options
     */

    /**
     * Constructs a new TechwolfStar.
     * @exports TechwolfStar
     * @classdesc Represents a TechwolfStar.
     * @implements ITechwolfStar
     * @constructor
     * @param {ITechwolfStar=} [properties] Properties to set
     */
    function TechwolfStar(properties) {
        this.options = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfStar starId.
     * @member {Long} starId
     * @memberof TechwolfStar
     * @instance
     */
    TechwolfStar.prototype.starId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

    /**
     * TechwolfStar starDesc.
     * @member {string} starDesc
     * @memberof TechwolfStar
     * @instance
     */
    TechwolfStar.prototype.starDesc = "";

    /**
     * TechwolfStar options.
     * @member {Array.<ITechwolfListItem>} options
     * @memberof TechwolfStar
     * @instance
     */
    TechwolfStar.prototype.options = $util.emptyArray;

    /**
     * Creates a new TechwolfStar instance using the specified properties.
     * @function create
     * @memberof TechwolfStar
     * @static
     * @param {ITechwolfStar=} [properties] Properties to set
     * @returns {TechwolfStar} TechwolfStar instance
     */
    TechwolfStar.create = function create(properties) {
        return new TechwolfStar(properties);
    };

    /**
     * Encodes the specified TechwolfStar message. Does not implicitly {@link TechwolfStar.verify|verify} messages.
     * @function encode
     * @memberof TechwolfStar
     * @static
     * @param {ITechwolfStar} message TechwolfStar message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfStar.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 0 =*/8).int64(message.starId);
        if (message.starDesc != null && Object.hasOwnProperty.call(message, "starDesc"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.starDesc);
        if (message.options != null && message.options.length)
            for (let i = 0; i < message.options.length; ++i)
                $root.TechwolfListItem.encode(message.options[i], writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfStar message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfStar
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfStar} TechwolfStar
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfStar.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfStar();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.starId = reader.int64();
                    break;
                }
            case 2: {
                    message.starDesc = reader.string();
                    break;
                }
            case 3: {
                    if (!(message.options && message.options.length))
                        message.options = [];
                    message.options.push($root.TechwolfListItem.decode(reader, reader.uint32()));
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("starId"))
            throw $util.ProtocolError("missing required 'starId'", { instance: message });
        return message;
    };

    return TechwolfStar;
})();

export const TechwolfStarRate = $root.TechwolfStarRate = (() => {

    /**
     * Properties of a TechwolfStarRate.
     * @exports ITechwolfStarRate
     * @interface ITechwolfStarRate
     * @property {string|null} [title] TechwolfStarRate title
     * @property {Array.<ITechwolfStar>|null} [stars] TechwolfStarRate stars
     * @property {number} rateStatus TechwolfStarRate rateStatus
     * @property {ITechwolfStar|null} [rateStar] TechwolfStarRate rateStar
     * @property {ITechwolfButton|null} [submitButton] TechwolfStarRate submitButton
     */

    /**
     * Constructs a new TechwolfStarRate.
     * @exports TechwolfStarRate
     * @classdesc Represents a TechwolfStarRate.
     * @implements ITechwolfStarRate
     * @constructor
     * @param {ITechwolfStarRate=} [properties] Properties to set
     */
    function TechwolfStarRate(properties) {
        this.stars = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfStarRate title.
     * @member {string} title
     * @memberof TechwolfStarRate
     * @instance
     */
    TechwolfStarRate.prototype.title = "";

    /**
     * TechwolfStarRate stars.
     * @member {Array.<ITechwolfStar>} stars
     * @memberof TechwolfStarRate
     * @instance
     */
    TechwolfStarRate.prototype.stars = $util.emptyArray;

    /**
     * TechwolfStarRate rateStatus.
     * @member {number} rateStatus
     * @memberof TechwolfStarRate
     * @instance
     */
    TechwolfStarRate.prototype.rateStatus = 0;

    /**
     * TechwolfStarRate rateStar.
     * @member {ITechwolfStar|null|undefined} rateStar
     * @memberof TechwolfStarRate
     * @instance
     */
    TechwolfStarRate.prototype.rateStar = null;

    /**
     * TechwolfStarRate submitButton.
     * @member {ITechwolfButton|null|undefined} submitButton
     * @memberof TechwolfStarRate
     * @instance
     */
    TechwolfStarRate.prototype.submitButton = null;

    /**
     * Creates a new TechwolfStarRate instance using the specified properties.
     * @function create
     * @memberof TechwolfStarRate
     * @static
     * @param {ITechwolfStarRate=} [properties] Properties to set
     * @returns {TechwolfStarRate} TechwolfStarRate instance
     */
    TechwolfStarRate.create = function create(properties) {
        return new TechwolfStarRate(properties);
    };

    /**
     * Encodes the specified TechwolfStarRate message. Does not implicitly {@link TechwolfStarRate.verify|verify} messages.
     * @function encode
     * @memberof TechwolfStarRate
     * @static
     * @param {ITechwolfStarRate} message TechwolfStarRate message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfStarRate.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.title != null && Object.hasOwnProperty.call(message, "title"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.title);
        if (message.stars != null && message.stars.length)
            for (let i = 0; i < message.stars.length; ++i)
                $root.TechwolfStar.encode(message.stars[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
        writer.uint32(/* id 3, wireType 0 =*/24).int32(message.rateStatus);
        if (message.rateStar != null && Object.hasOwnProperty.call(message, "rateStar"))
            $root.TechwolfStar.encode(message.rateStar, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
        if (message.submitButton != null && Object.hasOwnProperty.call(message, "submitButton"))
            $root.TechwolfButton.encode(message.submitButton, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfStarRate message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfStarRate
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfStarRate} TechwolfStarRate
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfStarRate.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfStarRate();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.title = reader.string();
                    break;
                }
            case 2: {
                    if (!(message.stars && message.stars.length))
                        message.stars = [];
                    message.stars.push($root.TechwolfStar.decode(reader, reader.uint32()));
                    break;
                }
            case 3: {
                    message.rateStatus = reader.int32();
                    break;
                }
            case 4: {
                    message.rateStar = $root.TechwolfStar.decode(reader, reader.uint32());
                    break;
                }
            case 5: {
                    message.submitButton = $root.TechwolfButton.decode(reader, reader.uint32());
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("rateStatus"))
            throw $util.ProtocolError("missing required 'rateStatus'", { instance: message });
        return message;
    };

    return TechwolfStarRate;
})();

export const TechwolfFrame = $root.TechwolfFrame = (() => {

    /**
     * Properties of a TechwolfFrame.
     * @exports ITechwolfFrame
     * @interface ITechwolfFrame
     * @property {string} href TechwolfFrame href
     */

    /**
     * Constructs a new TechwolfFrame.
     * @exports TechwolfFrame
     * @classdesc Represents a TechwolfFrame.
     * @implements ITechwolfFrame
     * @constructor
     * @param {ITechwolfFrame=} [properties] Properties to set
     */
    function TechwolfFrame(properties) {
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfFrame href.
     * @member {string} href
     * @memberof TechwolfFrame
     * @instance
     */
    TechwolfFrame.prototype.href = "";

    /**
     * Creates a new TechwolfFrame instance using the specified properties.
     * @function create
     * @memberof TechwolfFrame
     * @static
     * @param {ITechwolfFrame=} [properties] Properties to set
     * @returns {TechwolfFrame} TechwolfFrame instance
     */
    TechwolfFrame.create = function create(properties) {
        return new TechwolfFrame(properties);
    };

    /**
     * Encodes the specified TechwolfFrame message. Does not implicitly {@link TechwolfFrame.verify|verify} messages.
     * @function encode
     * @memberof TechwolfFrame
     * @static
     * @param {ITechwolfFrame} message TechwolfFrame message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfFrame.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        writer.uint32(/* id 1, wireType 2 =*/10).string(message.href);
        return writer;
    };

    /**
     * Decodes a TechwolfFrame message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfFrame
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfFrame} TechwolfFrame
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfFrame.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfFrame();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    message.href = reader.string();
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        if (!message.hasOwnProperty("href"))
            throw $util.ProtocolError("missing required 'href'", { instance: message });
        return message;
    };

    return TechwolfFrame;
})();

export const TechwolfMultiImage = $root.TechwolfMultiImage = (() => {

    /**
     * Properties of a TechwolfMultiImage.
     * @exports ITechwolfMultiImage
     * @interface ITechwolfMultiImage
     * @property {Array.<ITechwolfImageInfo>|null} [images] TechwolfMultiImage images
     */

    /**
     * Constructs a new TechwolfMultiImage.
     * @exports TechwolfMultiImage
     * @classdesc Represents a TechwolfMultiImage.
     * @implements ITechwolfMultiImage
     * @constructor
     * @param {ITechwolfMultiImage=} [properties] Properties to set
     */
    function TechwolfMultiImage(properties) {
        this.images = [];
        if (properties)
            for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * TechwolfMultiImage images.
     * @member {Array.<ITechwolfImageInfo>} images
     * @memberof TechwolfMultiImage
     * @instance
     */
    TechwolfMultiImage.prototype.images = $util.emptyArray;

    /**
     * Creates a new TechwolfMultiImage instance using the specified properties.
     * @function create
     * @memberof TechwolfMultiImage
     * @static
     * @param {ITechwolfMultiImage=} [properties] Properties to set
     * @returns {TechwolfMultiImage} TechwolfMultiImage instance
     */
    TechwolfMultiImage.create = function create(properties) {
        return new TechwolfMultiImage(properties);
    };

    /**
     * Encodes the specified TechwolfMultiImage message. Does not implicitly {@link TechwolfMultiImage.verify|verify} messages.
     * @function encode
     * @memberof TechwolfMultiImage
     * @static
     * @param {ITechwolfMultiImage} message TechwolfMultiImage message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    TechwolfMultiImage.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.images != null && message.images.length)
            for (let i = 0; i < message.images.length; ++i)
                $root.TechwolfImageInfo.encode(message.images[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
        return writer;
    };

    /**
     * Decodes a TechwolfMultiImage message from the specified reader or buffer.
     * @function decode
     * @memberof TechwolfMultiImage
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {TechwolfMultiImage} TechwolfMultiImage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    TechwolfMultiImage.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        let end = length === undefined ? reader.len : reader.pos + length, message = new $root.TechwolfMultiImage();
        while (reader.pos < end) {
            let tag = reader.uint32();
            switch (tag >>> 3) {
            case 1: {
                    if (!(message.images && message.images.length))
                        message.images = [];
                    message.images.push($root.TechwolfImageInfo.decode(reader, reader.uint32()));
                    break;
                }
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    return TechwolfMultiImage;
})();

export { $root as default };
