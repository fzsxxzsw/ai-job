import * as $protobuf from "protobufjs";
import Long = require("long");
/** Properties of a TechwolfUser. */
export interface ITechwolfUser {

    /** TechwolfUser uid */
    uid: Long;

    /** TechwolfUser name */
    name?: (string|null);

    /** TechwolfUser avatar */
    avatar?: (string|null);

    /** TechwolfUser company */
    company?: (string|null);

    /** TechwolfUser headImg */
    headImg?: (number|null);

    /** TechwolfUser certification */
    certification?: (number|null);

    /** TechwolfUser source */
    source?: (number|null);
}

/** Represents a TechwolfUser. */
export class TechwolfUser implements ITechwolfUser {

    /**
     * Constructs a new TechwolfUser.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfUser);

    /** TechwolfUser uid. */
    public uid: Long;

    /** TechwolfUser name. */
    public name: string;

    /** TechwolfUser avatar. */
    public avatar: string;

    /** TechwolfUser company. */
    public company: string;

    /** TechwolfUser headImg. */
    public headImg: number;

    /** TechwolfUser certification. */
    public certification: number;

    /** TechwolfUser source. */
    public source: number;

    /**
     * Creates a new TechwolfUser instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfUser instance
     */
    public static create(properties?: ITechwolfUser): TechwolfUser;

    /**
     * Encodes the specified TechwolfUser message. Does not implicitly {@link TechwolfUser.verify|verify} messages.
     * @param message TechwolfUser message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfUser, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfUser message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfUser
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfUser;
}

/** Properties of a TechwolfSound. */
export interface ITechwolfSound {

    /** TechwolfSound sid */
    sid?: (Long|null);

    /** TechwolfSound url */
    url?: (string|null);

    /** TechwolfSound duration */
    duration?: (number|null);

    /** TechwolfSound templateId */
    templateId?: (number|null);
}

/** Represents a TechwolfSound. */
export class TechwolfSound implements ITechwolfSound {

    /**
     * Constructs a new TechwolfSound.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfSound);

    /** TechwolfSound sid. */
    public sid: Long;

    /** TechwolfSound url. */
    public url: string;

    /** TechwolfSound duration. */
    public duration: number;

    /** TechwolfSound templateId. */
    public templateId: number;

    /**
     * Creates a new TechwolfSound instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfSound instance
     */
    public static create(properties?: ITechwolfSound): TechwolfSound;

    /**
     * Encodes the specified TechwolfSound message. Does not implicitly {@link TechwolfSound.verify|verify} messages.
     * @param message TechwolfSound message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfSound, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfSound message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfSound
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfSound;
}

/** Properties of a TechwolfVideo. */
export interface ITechwolfVideo {

    /** TechwolfVideo type */
    type: number;

    /** TechwolfVideo status */
    status: number;

    /** TechwolfVideo duration */
    duration?: (number|null);

    /** TechwolfVideo text */
    text?: (string|null);
}

/** Represents a TechwolfVideo. */
export class TechwolfVideo implements ITechwolfVideo {

    /**
     * Constructs a new TechwolfVideo.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfVideo);

    /** TechwolfVideo type. */
    public type: number;

    /** TechwolfVideo status. */
    public status: number;

    /** TechwolfVideo duration. */
    public duration: number;

    /** TechwolfVideo text. */
    public text: string;

    /**
     * Creates a new TechwolfVideo instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfVideo instance
     */
    public static create(properties?: ITechwolfVideo): TechwolfVideo;

    /**
     * Encodes the specified TechwolfVideo message. Does not implicitly {@link TechwolfVideo.verify|verify} messages.
     * @param message TechwolfVideo message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfVideo, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfVideo message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfVideo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfVideo;
}

/** Properties of a TechwolfInterview. */
export interface ITechwolfInterview {

    /** TechwolfInterview condition */
    condition: number;

    /** TechwolfInterview text */
    text: string;

    /** TechwolfInterview url */
    url?: (string|null);

    /** TechwolfInterview extend */
    extend?: (string|null);
}

/** Represents a TechwolfInterview. */
export class TechwolfInterview implements ITechwolfInterview {

    /**
     * Constructs a new TechwolfInterview.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfInterview);

    /** TechwolfInterview condition. */
    public condition: number;

    /** TechwolfInterview text. */
    public text: string;

    /** TechwolfInterview url. */
    public url: string;

    /** TechwolfInterview extend. */
    public extend: string;

    /**
     * Creates a new TechwolfInterview instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfInterview instance
     */
    public static create(properties?: ITechwolfInterview): TechwolfInterview;

    /**
     * Encodes the specified TechwolfInterview message. Does not implicitly {@link TechwolfInterview.verify|verify} messages.
     * @param message TechwolfInterview message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfInterview, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfInterview message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfInterview
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfInterview;
}

/** Properties of a TechwolfImageInfo. */
export interface ITechwolfImageInfo {

    /** TechwolfImageInfo url */
    url: string;

    /** TechwolfImageInfo width */
    width: number;

    /** TechwolfImageInfo height */
    height: number;
}

/** Represents a TechwolfImageInfo. */
export class TechwolfImageInfo implements ITechwolfImageInfo {

    /**
     * Constructs a new TechwolfImageInfo.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfImageInfo);

    /** TechwolfImageInfo url. */
    public url: string;

    /** TechwolfImageInfo width. */
    public width: number;

    /** TechwolfImageInfo height. */
    public height: number;

    /**
     * Creates a new TechwolfImageInfo instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfImageInfo instance
     */
    public static create(properties?: ITechwolfImageInfo): TechwolfImageInfo;

    /**
     * Encodes the specified TechwolfImageInfo message. Does not implicitly {@link TechwolfImageInfo.verify|verify} messages.
     * @param message TechwolfImageInfo message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfImageInfo, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfImageInfo message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfImageInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfImageInfo;
}

/** Properties of a TechwolfImage. */
export interface ITechwolfImage {

    /** TechwolfImage iid */
    iid?: (Long|null);

    /** TechwolfImage tinyImage */
    tinyImage?: (ITechwolfImageInfo|null);

    /** TechwolfImage originImage */
    originImage?: (ITechwolfImageInfo|null);
}

/** Represents a TechwolfImage. */
export class TechwolfImage implements ITechwolfImage {

    /**
     * Constructs a new TechwolfImage.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfImage);

    /** TechwolfImage iid. */
    public iid: Long;

    /** TechwolfImage tinyImage. */
    public tinyImage?: (ITechwolfImageInfo|null);

    /** TechwolfImage originImage. */
    public originImage?: (ITechwolfImageInfo|null);

    /**
     * Creates a new TechwolfImage instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfImage instance
     */
    public static create(properties?: ITechwolfImage): TechwolfImage;

    /**
     * Encodes the specified TechwolfImage message. Does not implicitly {@link TechwolfImage.verify|verify} messages.
     * @param message TechwolfImage message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfImage, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfImage message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfImage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfImage;
}

/** Properties of a TechwolfAction. */
export interface ITechwolfAction {

    /** TechwolfAction aid */
    aid: number;

    /** TechwolfAction extend */
    extend?: (string|null);
}

/** Represents a TechwolfAction. */
export class TechwolfAction implements ITechwolfAction {

    /**
     * Constructs a new TechwolfAction.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfAction);

    /** TechwolfAction aid. */
    public aid: number;

    /** TechwolfAction extend. */
    public extend: string;

    /**
     * Creates a new TechwolfAction instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfAction instance
     */
    public static create(properties?: ITechwolfAction): TechwolfAction;

    /**
     * Encodes the specified TechwolfAction message. Does not implicitly {@link TechwolfAction.verify|verify} messages.
     * @param message TechwolfAction message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfAction, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfAction message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfAction
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfAction;
}

/** Properties of a TechwolfArticle. */
export interface ITechwolfArticle {

    /** TechwolfArticle title */
    title: string;

    /** TechwolfArticle description */
    description: string;

    /** TechwolfArticle picUrl */
    picUrl: string;

    /** TechwolfArticle url */
    url: string;

    /** TechwolfArticle templateId */
    templateId?: (number|null);

    /** TechwolfArticle bottomText */
    bottomText?: (string|null);

    /** TechwolfArticle timeout */
    timeout?: (Long|null);

    /** TechwolfArticle statisticParameters */
    statisticParameters?: (string|null);

    /** TechwolfArticle highlightParts */
    highlightParts?: (ITechwolfSlice[]|null);

    /** TechwolfArticle dimParts */
    dimParts?: (ITechwolfSlice[]|null);

    /** TechwolfArticle subTitle */
    subTitle?: (string|null);

    /** TechwolfArticle extend */
    extend?: (string|null);
}

/** Represents a TechwolfArticle. */
export class TechwolfArticle implements ITechwolfArticle {

    /**
     * Constructs a new TechwolfArticle.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfArticle);

    /** TechwolfArticle title. */
    public title: string;

    /** TechwolfArticle description. */
    public description: string;

    /** TechwolfArticle picUrl. */
    public picUrl: string;

    /** TechwolfArticle url. */
    public url: string;

    /** TechwolfArticle templateId. */
    public templateId: number;

    /** TechwolfArticle bottomText. */
    public bottomText: string;

    /** TechwolfArticle timeout. */
    public timeout: Long;

    /** TechwolfArticle statisticParameters. */
    public statisticParameters: string;

    /** TechwolfArticle highlightParts. */
    public highlightParts: ITechwolfSlice[];

    /** TechwolfArticle dimParts. */
    public dimParts: ITechwolfSlice[];

    /** TechwolfArticle subTitle. */
    public subTitle: string;

    /** TechwolfArticle extend. */
    public extend: string;

    /**
     * Creates a new TechwolfArticle instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfArticle instance
     */
    public static create(properties?: ITechwolfArticle): TechwolfArticle;

    /**
     * Encodes the specified TechwolfArticle message. Does not implicitly {@link TechwolfArticle.verify|verify} messages.
     * @param message TechwolfArticle message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfArticle, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfArticle message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfArticle
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfArticle;
}

/** Properties of a TechwolfNotify. */
export interface ITechwolfNotify {

    /** TechwolfNotify text */
    text: string;

    /** TechwolfNotify url */
    url?: (string|null);

    /** TechwolfNotify title */
    title?: (string|null);
}

/** Represents a TechwolfNotify. */
export class TechwolfNotify implements ITechwolfNotify {

    /**
     * Constructs a new TechwolfNotify.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfNotify);

    /** TechwolfNotify text. */
    public text: string;

    /** TechwolfNotify url. */
    public url: string;

    /** TechwolfNotify title. */
    public title: string;

    /**
     * Creates a new TechwolfNotify instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfNotify instance
     */
    public static create(properties?: ITechwolfNotify): TechwolfNotify;

    /**
     * Encodes the specified TechwolfNotify message. Does not implicitly {@link TechwolfNotify.verify|verify} messages.
     * @param message TechwolfNotify message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfNotify, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfNotify message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfNotify
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfNotify;
}

/** Properties of a TechwolfButton. */
export interface ITechwolfButton {

    /** TechwolfButton text */
    text: string;

    /** TechwolfButton url */
    url?: (string|null);

    /** TechwolfButton templateId */
    templateId?: (number|null);
}

/** Represents a TechwolfButton. */
export class TechwolfButton implements ITechwolfButton {

    /**
     * Constructs a new TechwolfButton.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfButton);

    /** TechwolfButton text. */
    public text: string;

    /** TechwolfButton url. */
    public url: string;

    /** TechwolfButton templateId. */
    public templateId: number;

    /**
     * Creates a new TechwolfButton instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfButton instance
     */
    public static create(properties?: ITechwolfButton): TechwolfButton;

    /**
     * Encodes the specified TechwolfButton message. Does not implicitly {@link TechwolfButton.verify|verify} messages.
     * @param message TechwolfButton message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfButton, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfButton message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfButton
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfButton;
}

/** Properties of a TechwolfDialog. */
export interface ITechwolfDialog {

    /** TechwolfDialog text */
    text: string;

    /** TechwolfDialog buttons */
    buttons?: (ITechwolfButton[]|null);

    /** TechwolfDialog operated */
    operated: boolean;

    /** TechwolfDialog clickMore */
    clickMore?: (boolean|null);

    /** TechwolfDialog type */
    type?: (number|null);

    /** TechwolfDialog backgroundUrl */
    backgroundUrl?: (string|null);

    /** TechwolfDialog timeout */
    timeout?: (Long|null);

    /** TechwolfDialog statisticParameters */
    statisticParameters?: (string|null);

    /** TechwolfDialog title */
    title?: (string|null);

    /** TechwolfDialog url */
    url?: (string|null);

    /** TechwolfDialog selectedIndex */
    selectedIndex?: (number|null);

    /** TechwolfDialog extend */
    extend?: (string|null);

    /** TechwolfDialog content */
    content?: (string|null);
}

/** Represents a TechwolfDialog. */
export class TechwolfDialog implements ITechwolfDialog {

    /**
     * Constructs a new TechwolfDialog.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfDialog);

    /** TechwolfDialog text. */
    public text: string;

    /** TechwolfDialog buttons. */
    public buttons: ITechwolfButton[];

    /** TechwolfDialog operated. */
    public operated: boolean;

    /** TechwolfDialog clickMore. */
    public clickMore: boolean;

    /** TechwolfDialog type. */
    public type: number;

    /** TechwolfDialog backgroundUrl. */
    public backgroundUrl: string;

    /** TechwolfDialog timeout. */
    public timeout: Long;

    /** TechwolfDialog statisticParameters. */
    public statisticParameters: string;

    /** TechwolfDialog title. */
    public title: string;

    /** TechwolfDialog url. */
    public url: string;

    /** TechwolfDialog selectedIndex. */
    public selectedIndex: number;

    /** TechwolfDialog extend. */
    public extend: string;

    /** TechwolfDialog content. */
    public content: string;

    /**
     * Creates a new TechwolfDialog instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfDialog instance
     */
    public static create(properties?: ITechwolfDialog): TechwolfDialog;

    /**
     * Encodes the specified TechwolfDialog message. Does not implicitly {@link TechwolfDialog.verify|verify} messages.
     * @param message TechwolfDialog message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfDialog, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfDialog message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfDialog
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfDialog;
}

/** Properties of a TechwolfJobDesc. */
export interface ITechwolfJobDesc {

    /** TechwolfJobDesc title */
    title: string;

    /** TechwolfJobDesc company */
    company: string;

    /** TechwolfJobDesc salary */
    salary: string;

    /** TechwolfJobDesc url */
    url: string;

    /** TechwolfJobDesc jobId */
    jobId: Long;

    /** TechwolfJobDesc positionCategory */
    positionCategory?: (string|null);

    /** TechwolfJobDesc experience */
    experience?: (string|null);

    /** TechwolfJobDesc education */
    education?: (string|null);

    /** TechwolfJobDesc city */
    city?: (string|null);

    /** TechwolfJobDesc bossTitle */
    bossTitle?: (string|null);

    /** TechwolfJobDesc boss */
    boss?: (ITechwolfUser|null);

    /** TechwolfJobDesc lid */
    lid?: (string|null);

    /** TechwolfJobDesc stage */
    stage?: (string|null);

    /** TechwolfJobDesc bottomText */
    bottomText?: (string|null);

    /** TechwolfJobDesc jobLabel */
    jobLabel?: (string|null);

    /** TechwolfJobDesc iconFlag */
    iconFlag?: (number|null);

    /** TechwolfJobDesc content */
    content?: (string|null);

    /** TechwolfJobDesc labels */
    labels?: (string[]|null);

    /** TechwolfJobDesc expectId */
    expectId?: (Long|null);

    /** TechwolfJobDesc expectPosition */
    expectPosition?: (string|null);

    /** TechwolfJobDesc expectSalary */
    expectSalary?: (string|null);

    /** TechwolfJobDesc partTimeDesc */
    partTimeDesc?: (string|null);

    /** TechwolfJobDesc geek */
    geek?: (ITechwolfUser|null);

    /** TechwolfJobDesc latlon */
    latlon?: (string|null);

    /** TechwolfJobDesc distance */
    distance?: (string|null);
}

/** Represents a TechwolfJobDesc. */
export class TechwolfJobDesc implements ITechwolfJobDesc {

    /**
     * Constructs a new TechwolfJobDesc.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfJobDesc);

    /** TechwolfJobDesc title. */
    public title: string;

    /** TechwolfJobDesc company. */
    public company: string;

    /** TechwolfJobDesc salary. */
    public salary: string;

    /** TechwolfJobDesc url. */
    public url: string;

    /** TechwolfJobDesc jobId. */
    public jobId: Long;

    /** TechwolfJobDesc positionCategory. */
    public positionCategory: string;

    /** TechwolfJobDesc experience. */
    public experience: string;

    /** TechwolfJobDesc education. */
    public education: string;

    /** TechwolfJobDesc city. */
    public city: string;

    /** TechwolfJobDesc bossTitle. */
    public bossTitle: string;

    /** TechwolfJobDesc boss. */
    public boss?: (ITechwolfUser|null);

    /** TechwolfJobDesc lid. */
    public lid: string;

    /** TechwolfJobDesc stage. */
    public stage: string;

    /** TechwolfJobDesc bottomText. */
    public bottomText: string;

    /** TechwolfJobDesc jobLabel. */
    public jobLabel: string;

    /** TechwolfJobDesc iconFlag. */
    public iconFlag: number;

    /** TechwolfJobDesc content. */
    public content: string;

    /** TechwolfJobDesc labels. */
    public labels: string[];

    /** TechwolfJobDesc expectId. */
    public expectId: Long;

    /** TechwolfJobDesc expectPosition. */
    public expectPosition: string;

    /** TechwolfJobDesc expectSalary. */
    public expectSalary: string;

    /** TechwolfJobDesc partTimeDesc. */
    public partTimeDesc: string;

    /** TechwolfJobDesc geek. */
    public geek?: (ITechwolfUser|null);

    /** TechwolfJobDesc latlon. */
    public latlon: string;

    /** TechwolfJobDesc distance. */
    public distance: string;

    /**
     * Creates a new TechwolfJobDesc instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfJobDesc instance
     */
    public static create(properties?: ITechwolfJobDesc): TechwolfJobDesc;

    /**
     * Encodes the specified TechwolfJobDesc message. Does not implicitly {@link TechwolfJobDesc.verify|verify} messages.
     * @param message TechwolfJobDesc message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfJobDesc, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfJobDesc message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfJobDesc
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfJobDesc;
}

/** Properties of a TechwolfResume. */
export interface ITechwolfResume {

    /** TechwolfResume user */
    user: ITechwolfUser;

    /** TechwolfResume description */
    description?: (string|null);

    /** TechwolfResume city */
    city?: (string|null);

    /** TechwolfResume position */
    position?: (string|null);

    /** TechwolfResume keywords */
    keywords?: (string[]|null);

    /** TechwolfResume expectId */
    expectId?: (Long|null);

    /** TechwolfResume lid */
    lid?: (string|null);

    /** TechwolfResume gender */
    gender?: (number|null);

    /** TechwolfResume salary */
    salary?: (string|null);

    /** TechwolfResume workYear */
    workYear?: (string|null);

    /** TechwolfResume content1 */
    content1?: (string|null);

    /** TechwolfResume content2 */
    content2?: (string|null);

    /** TechwolfResume education */
    education?: (string|null);

    /** TechwolfResume age */
    age?: (string|null);

    /** TechwolfResume labels */
    labels?: (string[]|null);

    /** TechwolfResume experiences */
    experiences?: (IUserExperience[]|null);

    /** TechwolfResume positionCategory */
    positionCategory?: (string|null);

    /** TechwolfResume jobSalary */
    jobSalary?: (string|null);

    /** TechwolfResume bottomText */
    bottomText?: (string|null);

    /** TechwolfResume applyStatus */
    applyStatus?: (string|null);

    /** TechwolfResume jobId */
    jobId?: (Long|null);

    /** TechwolfResume content3 */
    content3?: (string|null);

    /** TechwolfResume securityId */
    securityId?: (string|null);

    /** TechwolfResume boss */
    boss?: (ITechwolfUser|null);

    /** TechwolfResume brandName */
    brandName?: (string|null);
}

/** Represents a TechwolfResume. */
export class TechwolfResume implements ITechwolfResume {

    /**
     * Constructs a new TechwolfResume.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfResume);

    /** TechwolfResume user. */
    public user: ITechwolfUser;

    /** TechwolfResume description. */
    public description: string;

    /** TechwolfResume city. */
    public city: string;

    /** TechwolfResume position. */
    public position: string;

    /** TechwolfResume keywords. */
    public keywords: string[];

    /** TechwolfResume expectId. */
    public expectId: Long;

    /** TechwolfResume lid. */
    public lid: string;

    /** TechwolfResume gender. */
    public gender: number;

    /** TechwolfResume salary. */
    public salary: string;

    /** TechwolfResume workYear. */
    public workYear: string;

    /** TechwolfResume content1. */
    public content1: string;

    /** TechwolfResume content2. */
    public content2: string;

    /** TechwolfResume education. */
    public education: string;

    /** TechwolfResume age. */
    public age: string;

    /** TechwolfResume labels. */
    public labels: string[];

    /** TechwolfResume experiences. */
    public experiences: IUserExperience[];

    /** TechwolfResume positionCategory. */
    public positionCategory: string;

    /** TechwolfResume jobSalary. */
    public jobSalary: string;

    /** TechwolfResume bottomText. */
    public bottomText: string;

    /** TechwolfResume applyStatus. */
    public applyStatus: string;

    /** TechwolfResume jobId. */
    public jobId: Long;

    /** TechwolfResume content3. */
    public content3: string;

    /** TechwolfResume securityId. */
    public securityId: string;

    /** TechwolfResume boss. */
    public boss?: (ITechwolfUser|null);

    /** TechwolfResume brandName. */
    public brandName: string;

    /**
     * Creates a new TechwolfResume instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfResume instance
     */
    public static create(properties?: ITechwolfResume): TechwolfResume;

    /**
     * Encodes the specified TechwolfResume message. Does not implicitly {@link TechwolfResume.verify|verify} messages.
     * @param message TechwolfResume message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfResume, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfResume message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfResume
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfResume;
}

/** Properties of a TechwolfHyperLink. */
export interface ITechwolfHyperLink {

    /** TechwolfHyperLink text */
    text: string;

    /** TechwolfHyperLink url */
    url: string;

    /** TechwolfHyperLink hyperLinkType */
    hyperLinkType: number;

    /** TechwolfHyperLink extraJson */
    extraJson?: (string|null);
}

/** Represents a TechwolfHyperLink. */
export class TechwolfHyperLink implements ITechwolfHyperLink {

    /**
     * Constructs a new TechwolfHyperLink.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfHyperLink);

    /** TechwolfHyperLink text. */
    public text: string;

    /** TechwolfHyperLink url. */
    public url: string;

    /** TechwolfHyperLink hyperLinkType. */
    public hyperLinkType: number;

    /** TechwolfHyperLink extraJson. */
    public extraJson: string;

    /**
     * Creates a new TechwolfHyperLink instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfHyperLink instance
     */
    public static create(properties?: ITechwolfHyperLink): TechwolfHyperLink;

    /**
     * Encodes the specified TechwolfHyperLink message. Does not implicitly {@link TechwolfHyperLink.verify|verify} messages.
     * @param message TechwolfHyperLink message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfHyperLink, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfHyperLink message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfHyperLink
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfHyperLink;
}

/** Properties of a TechwolfMessageBody. */
export interface ITechwolfMessageBody {

    /** TechwolfMessageBody type */
    type: number;

    /** TechwolfMessageBody templateId */
    templateId: number;

    /** TechwolfMessageBody headTitle */
    headTitle?: (string|null);

    /** TechwolfMessageBody text */
    text?: (string|null);

    /** TechwolfMessageBody sound */
    sound?: (ITechwolfSound|null);

    /** TechwolfMessageBody image */
    image?: (ITechwolfImage|null);

    /** TechwolfMessageBody action */
    action?: (ITechwolfAction|null);

    /** TechwolfMessageBody articles */
    articles?: (ITechwolfArticle[]|null);

    /** TechwolfMessageBody notify */
    notify?: (ITechwolfNotify|null);

    /** TechwolfMessageBody dialog */
    dialog?: (ITechwolfDialog|null);

    /** TechwolfMessageBody jobDesc */
    jobDesc?: (ITechwolfJobDesc|null);

    /** TechwolfMessageBody resume */
    resume?: (ITechwolfResume|null);

    /** TechwolfMessageBody redEnvelope */
    redEnvelope?: (ITechwolfRedEnvelope|null);

    /** TechwolfMessageBody orderDetail */
    orderDetail?: (ITechwolfOrderDetail|null);

    /** TechwolfMessageBody hyperLink */
    hyperLink?: (ITechwolfHyperLink|null);

    /** TechwolfMessageBody video */
    video?: (ITechwolfVideo|null);

    /** TechwolfMessageBody interview */
    interview?: (ITechwolfInterview|null);

    /** TechwolfMessageBody jobShare */
    jobShare?: (ITechwolfJobShare|null);

    /** TechwolfMessageBody resumeShare */
    resumeShare?: (ITechwolfResumeShare|null);

    /** TechwolfMessageBody atInfo */
    atInfo?: (IAtInfo|null);

    /** TechwolfMessageBody sticker */
    sticker?: (ITechwolfSticker|null);

    /** TechwolfMessageBody chatShare */
    chatShare?: (ITechwolfChatShare|null);

    /** TechwolfMessageBody interviewShare */
    interviewShare?: (ITechwolfInterviewShare|null);

    /** TechwolfMessageBody listCard */
    listCard?: (ITechwolfListCard|null);

    /** TechwolfMessageBody starRate */
    starRate?: (ITechwolfStarRate|null);

    /** TechwolfMessageBody frame */
    frame?: (ITechwolfFrame|null);

    /** TechwolfMessageBody multiImage */
    multiImage?: (ITechwolfMultiImage|null);

    /** TechwolfMessageBody extend */
    extend?: (string|null);
}

/** Represents a TechwolfMessageBody. */
export class TechwolfMessageBody implements ITechwolfMessageBody {

    /**
     * Constructs a new TechwolfMessageBody.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfMessageBody);

    /** TechwolfMessageBody type. */
    public type: number;

    /** TechwolfMessageBody templateId. */
    public templateId: number;

    /** TechwolfMessageBody headTitle. */
    public headTitle: string;

    /** TechwolfMessageBody text. */
    public text: string;

    /** TechwolfMessageBody sound. */
    public sound?: (ITechwolfSound|null);

    /** TechwolfMessageBody image. */
    public image?: (ITechwolfImage|null);

    /** TechwolfMessageBody action. */
    public action?: (ITechwolfAction|null);

    /** TechwolfMessageBody articles. */
    public articles: ITechwolfArticle[];

    /** TechwolfMessageBody notify. */
    public notify?: (ITechwolfNotify|null);

    /** TechwolfMessageBody dialog. */
    public dialog?: (ITechwolfDialog|null);

    /** TechwolfMessageBody jobDesc. */
    public jobDesc?: (ITechwolfJobDesc|null);

    /** TechwolfMessageBody resume. */
    public resume?: (ITechwolfResume|null);

    /** TechwolfMessageBody redEnvelope. */
    public redEnvelope?: (ITechwolfRedEnvelope|null);

    /** TechwolfMessageBody orderDetail. */
    public orderDetail?: (ITechwolfOrderDetail|null);

    /** TechwolfMessageBody hyperLink. */
    public hyperLink?: (ITechwolfHyperLink|null);

    /** TechwolfMessageBody video. */
    public video?: (ITechwolfVideo|null);

    /** TechwolfMessageBody interview. */
    public interview?: (ITechwolfInterview|null);

    /** TechwolfMessageBody jobShare. */
    public jobShare?: (ITechwolfJobShare|null);

    /** TechwolfMessageBody resumeShare. */
    public resumeShare?: (ITechwolfResumeShare|null);

    /** TechwolfMessageBody atInfo. */
    public atInfo?: (IAtInfo|null);

    /** TechwolfMessageBody sticker. */
    public sticker?: (ITechwolfSticker|null);

    /** TechwolfMessageBody chatShare. */
    public chatShare?: (ITechwolfChatShare|null);

    /** TechwolfMessageBody interviewShare. */
    public interviewShare?: (ITechwolfInterviewShare|null);

    /** TechwolfMessageBody listCard. */
    public listCard?: (ITechwolfListCard|null);

    /** TechwolfMessageBody starRate. */
    public starRate?: (ITechwolfStarRate|null);

    /** TechwolfMessageBody frame. */
    public frame?: (ITechwolfFrame|null);

    /** TechwolfMessageBody multiImage. */
    public multiImage?: (ITechwolfMultiImage|null);

    /** TechwolfMessageBody extend. */
    public extend: string;

    /**
     * Creates a new TechwolfMessageBody instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfMessageBody instance
     */
    public static create(properties?: ITechwolfMessageBody): TechwolfMessageBody;

    /**
     * Encodes the specified TechwolfMessageBody message. Does not implicitly {@link TechwolfMessageBody.verify|verify} messages.
     * @param message TechwolfMessageBody message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfMessageBody, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfMessageBody message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfMessageBody
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfMessageBody;
}

/** Properties of a TechwolfMessage. */
export interface ITechwolfMessage {

    /** TechwolfMessage from */
    from: ITechwolfUser;

    /** TechwolfMessage to */
    to: ITechwolfUser;

    /** TechwolfMessage type */
    type: number;

    /** TechwolfMessage mid */
    mid?: (Long|null);

    /** TechwolfMessage time */
    time?: (Long|null);

    /** TechwolfMessage body */
    body: ITechwolfMessageBody;

    /** TechwolfMessage offline */
    offline?: (boolean|null);

    /** TechwolfMessage received */
    received?: (boolean|null);

    /** TechwolfMessage pushText */
    pushText?: (string|null);

    /** TechwolfMessage taskId */
    taskId?: (Long|null);

    /** TechwolfMessage cmid */
    cmid?: (Long|null);

    /** TechwolfMessage status */
    status?: (number|null);

    /** TechwolfMessage uncount */
    uncount?: (number|null);

    /** TechwolfMessage pushSound */
    pushSound?: (number|null);

    /** TechwolfMessage flag */
    flag?: (number|null);

    /** TechwolfMessage encryptedBody */
    encryptedBody?: (Uint8Array|null);

    /** TechwolfMessage bizId */
    bizId?: (string|null);

    /** TechwolfMessage bizType */
    bizType?: (number|null);

    /** TechwolfMessage securityId */
    securityId?: (string|null);
}

/** Represents a TechwolfMessage. */
export class TechwolfMessage implements ITechwolfMessage {

    /**
     * Constructs a new TechwolfMessage.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfMessage);

    /** TechwolfMessage from. */
    public from: ITechwolfUser;

    /** TechwolfMessage to. */
    public to: ITechwolfUser;

    /** TechwolfMessage type. */
    public type: number;

    /** TechwolfMessage mid. */
    public mid: Long;

    /** TechwolfMessage time. */
    public time: Long;

    /** TechwolfMessage body. */
    public body: ITechwolfMessageBody;

    /** TechwolfMessage offline. */
    public offline: boolean;

    /** TechwolfMessage received. */
    public received: boolean;

    /** TechwolfMessage pushText. */
    public pushText: string;

    /** TechwolfMessage taskId. */
    public taskId: Long;

    /** TechwolfMessage cmid. */
    public cmid: Long;

    /** TechwolfMessage status. */
    public status: number;

    /** TechwolfMessage uncount. */
    public uncount: number;

    /** TechwolfMessage pushSound. */
    public pushSound: number;

    /** TechwolfMessage flag. */
    public flag: number;

    /** TechwolfMessage encryptedBody. */
    public encryptedBody: Uint8Array;

    /** TechwolfMessage bizId. */
    public bizId: string;

    /** TechwolfMessage bizType. */
    public bizType: number;

    /** TechwolfMessage securityId. */
    public securityId: string;

    /**
     * Creates a new TechwolfMessage instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfMessage instance
     */
    public static create(properties?: ITechwolfMessage): TechwolfMessage;

    /**
     * Encodes the specified TechwolfMessage message. Does not implicitly {@link TechwolfMessage.verify|verify} messages.
     * @param message TechwolfMessage message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfMessage, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfMessage message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfMessage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfMessage;
}

/** Properties of a TechwolfClientInfo. */
export interface ITechwolfClientInfo {

    /** TechwolfClientInfo version */
    version?: (string|null);

    /** TechwolfClientInfo system */
    system?: (string|null);

    /** TechwolfClientInfo systemVersion */
    systemVersion?: (string|null);

    /** TechwolfClientInfo model */
    model?: (string|null);

    /** TechwolfClientInfo uniqid */
    uniqid?: (string|null);

    /** TechwolfClientInfo network */
    network?: (string|null);

    /** TechwolfClientInfo appid */
    appid?: (number|null);

    /** TechwolfClientInfo platform */
    platform?: (string|null);

    /** TechwolfClientInfo channel */
    channel?: (string|null);

    /** TechwolfClientInfo ssid */
    ssid?: (string|null);

    /** TechwolfClientInfo bssid */
    bssid?: (string|null);

    /** TechwolfClientInfo longitude */
    longitude?: (number|null);

    /** TechwolfClientInfo latitude */
    latitude?: (number|null);
}

/** Represents a TechwolfClientInfo. */
export class TechwolfClientInfo implements ITechwolfClientInfo {

    /**
     * Constructs a new TechwolfClientInfo.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfClientInfo);

    /** TechwolfClientInfo version. */
    public version: string;

    /** TechwolfClientInfo system. */
    public system: string;

    /** TechwolfClientInfo systemVersion. */
    public systemVersion: string;

    /** TechwolfClientInfo model. */
    public model: string;

    /** TechwolfClientInfo uniqid. */
    public uniqid: string;

    /** TechwolfClientInfo network. */
    public network: string;

    /** TechwolfClientInfo appid. */
    public appid: number;

    /** TechwolfClientInfo platform. */
    public platform: string;

    /** TechwolfClientInfo channel. */
    public channel: string;

    /** TechwolfClientInfo ssid. */
    public ssid: string;

    /** TechwolfClientInfo bssid. */
    public bssid: string;

    /** TechwolfClientInfo longitude. */
    public longitude: number;

    /** TechwolfClientInfo latitude. */
    public latitude: number;

    /**
     * Creates a new TechwolfClientInfo instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfClientInfo instance
     */
    public static create(properties?: ITechwolfClientInfo): TechwolfClientInfo;

    /**
     * Encodes the specified TechwolfClientInfo message. Does not implicitly {@link TechwolfClientInfo.verify|verify} messages.
     * @param message TechwolfClientInfo message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfClientInfo, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfClientInfo message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfClientInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfClientInfo;
}

/** Properties of a TechwolfClientTime. */
export interface ITechwolfClientTime {

    /** TechwolfClientTime startTime */
    startTime?: (Long|null);

    /** TechwolfClientTime resumeTime */
    resumeTime?: (Long|null);
}

/** Represents a TechwolfClientTime. */
export class TechwolfClientTime implements ITechwolfClientTime {

    /**
     * Constructs a new TechwolfClientTime.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfClientTime);

    /** TechwolfClientTime startTime. */
    public startTime: Long;

    /** TechwolfClientTime resumeTime. */
    public resumeTime: Long;

    /**
     * Creates a new TechwolfClientTime instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfClientTime instance
     */
    public static create(properties?: ITechwolfClientTime): TechwolfClientTime;

    /**
     * Encodes the specified TechwolfClientTime message. Does not implicitly {@link TechwolfClientTime.verify|verify} messages.
     * @param message TechwolfClientTime message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfClientTime, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfClientTime message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfClientTime
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfClientTime;
}

/** Properties of a TechwolfPresence. */
export interface ITechwolfPresence {

    /** TechwolfPresence type */
    type: number;

    /** TechwolfPresence uid */
    uid: number;

    /** TechwolfPresence clientInfo */
    clientInfo?: (ITechwolfClientInfo|null);

    /** TechwolfPresence clientTime */
    clientTime?: (ITechwolfClientTime|null);

    /** TechwolfPresence lastMessageId */
    lastMessageId?: (Long|null);

    /** TechwolfPresence lastGroupMessageId */
    lastGroupMessageId?: (Long|null);

    /** TechwolfPresence userId */
    userId?: (Long|null);
}

/** Represents a TechwolfPresence. */
export class TechwolfPresence implements ITechwolfPresence {

    /**
     * Constructs a new TechwolfPresence.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfPresence);

    /** TechwolfPresence type. */
    public type: number;

    /** TechwolfPresence uid. */
    public uid: number;

    /** TechwolfPresence clientInfo. */
    public clientInfo?: (ITechwolfClientInfo|null);

    /** TechwolfPresence clientTime. */
    public clientTime?: (ITechwolfClientTime|null);

    /** TechwolfPresence lastMessageId. */
    public lastMessageId: Long;

    /** TechwolfPresence lastGroupMessageId. */
    public lastGroupMessageId: Long;

    /** TechwolfPresence userId. */
    public userId: Long;

    /**
     * Creates a new TechwolfPresence instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfPresence instance
     */
    public static create(properties?: ITechwolfPresence): TechwolfPresence;

    /**
     * Encodes the specified TechwolfPresence message. Does not implicitly {@link TechwolfPresence.verify|verify} messages.
     * @param message TechwolfPresence message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfPresence, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfPresence message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfPresence
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfPresence;
}

/** Properties of a TechwolfKVEntry. */
export interface ITechwolfKVEntry {

    /** TechwolfKVEntry key */
    key: string;

    /** TechwolfKVEntry value */
    value: string;
}

/** Represents a TechwolfKVEntry. */
export class TechwolfKVEntry implements ITechwolfKVEntry {

    /**
     * Constructs a new TechwolfKVEntry.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfKVEntry);

    /** TechwolfKVEntry key. */
    public key: string;

    /** TechwolfKVEntry value. */
    public value: string;

    /**
     * Creates a new TechwolfKVEntry instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfKVEntry instance
     */
    public static create(properties?: ITechwolfKVEntry): TechwolfKVEntry;

    /**
     * Encodes the specified TechwolfKVEntry message. Does not implicitly {@link TechwolfKVEntry.verify|verify} messages.
     * @param message TechwolfKVEntry message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfKVEntry, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfKVEntry message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfKVEntry
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfKVEntry;
}

/** Properties of a TechwolfIq. */
export interface ITechwolfIq {

    /** TechwolfIq qid */
    qid: Long;

    /** TechwolfIq query */
    query: string;

    /** TechwolfIq params */
    params?: (ITechwolfKVEntry[]|null);
}

/** Represents a TechwolfIq. */
export class TechwolfIq implements ITechwolfIq {

    /**
     * Constructs a new TechwolfIq.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfIq);

    /** TechwolfIq qid. */
    public qid: Long;

    /** TechwolfIq query. */
    public query: string;

    /** TechwolfIq params. */
    public params: ITechwolfKVEntry[];

    /**
     * Creates a new TechwolfIq instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfIq instance
     */
    public static create(properties?: ITechwolfIq): TechwolfIq;

    /**
     * Encodes the specified TechwolfIq message. Does not implicitly {@link TechwolfIq.verify|verify} messages.
     * @param message TechwolfIq message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfIq, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfIq message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfIq
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfIq;
}

/** Properties of a TechwolfIqResponse. */
export interface ITechwolfIqResponse {

    /** TechwolfIqResponse qid */
    qid: Long;

    /** TechwolfIqResponse query */
    query: string;

    /** TechwolfIqResponse results */
    results?: (ITechwolfKVEntry[]|null);
}

/** Represents a TechwolfIqResponse. */
export class TechwolfIqResponse implements ITechwolfIqResponse {

    /**
     * Constructs a new TechwolfIqResponse.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfIqResponse);

    /** TechwolfIqResponse qid. */
    public qid: Long;

    /** TechwolfIqResponse query. */
    public query: string;

    /** TechwolfIqResponse results. */
    public results: ITechwolfKVEntry[];

    /**
     * Creates a new TechwolfIqResponse instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfIqResponse instance
     */
    public static create(properties?: ITechwolfIqResponse): TechwolfIqResponse;

    /**
     * Encodes the specified TechwolfIqResponse message. Does not implicitly {@link TechwolfIqResponse.verify|verify} messages.
     * @param message TechwolfIqResponse message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfIqResponse, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfIqResponse message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfIqResponse
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfIqResponse;
}

/** Properties of a TechwolfMessageSync. */
export interface ITechwolfMessageSync {

    /** TechwolfMessageSync clientMid */
    clientMid: Long;

    /** TechwolfMessageSync serverMid */
    serverMid: Long;
}

/** Represents a TechwolfMessageSync. */
export class TechwolfMessageSync implements ITechwolfMessageSync {

    /**
     * Constructs a new TechwolfMessageSync.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfMessageSync);

    /** TechwolfMessageSync clientMid. */
    public clientMid: Long;

    /** TechwolfMessageSync serverMid. */
    public serverMid: Long;

    /**
     * Creates a new TechwolfMessageSync instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfMessageSync instance
     */
    public static create(properties?: ITechwolfMessageSync): TechwolfMessageSync;

    /**
     * Encodes the specified TechwolfMessageSync message. Does not implicitly {@link TechwolfMessageSync.verify|verify} messages.
     * @param message TechwolfMessageSync message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfMessageSync, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfMessageSync message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfMessageSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfMessageSync;
}

/** Properties of a TechwolfMessageRead. */
export interface ITechwolfMessageRead {

    /** TechwolfMessageRead userId */
    userId: Long;

    /** TechwolfMessageRead messageId */
    messageId: Long;

    /** TechwolfMessageRead readTime */
    readTime: Long;

    /** TechwolfMessageRead sync */
    sync?: (boolean|null);

    /** TechwolfMessageRead userSource */
    userSource?: (number|null);
}

/** Represents a TechwolfMessageRead. */
export class TechwolfMessageRead implements ITechwolfMessageRead {

    /**
     * Constructs a new TechwolfMessageRead.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfMessageRead);

    /** TechwolfMessageRead userId. */
    public userId: Long;

    /** TechwolfMessageRead messageId. */
    public messageId: Long;

    /** TechwolfMessageRead readTime. */
    public readTime: Long;

    /** TechwolfMessageRead sync. */
    public sync: boolean;

    /** TechwolfMessageRead userSource. */
    public userSource: number;

    /**
     * Creates a new TechwolfMessageRead instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfMessageRead instance
     */
    public static create(properties?: ITechwolfMessageRead): TechwolfMessageRead;

    /**
     * Encodes the specified TechwolfMessageRead message. Does not implicitly {@link TechwolfMessageRead.verify|verify} messages.
     * @param message TechwolfMessageRead message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfMessageRead, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfMessageRead message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfMessageRead
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfMessageRead;
}

/** Properties of a TechwolfChatProtocol. */
export interface ITechwolfChatProtocol {

    /** TechwolfChatProtocol type */
    type: number;

    /** TechwolfChatProtocol version */
    version?: (string|null);

    /** TechwolfChatProtocol messages */
    messages?: (ITechwolfMessage[]|null);

    /** TechwolfChatProtocol presence */
    presence?: (ITechwolfPresence|null);

    /** TechwolfChatProtocol iq */
    iq?: (ITechwolfIq|null);

    /** TechwolfChatProtocol iqResponse */
    iqResponse?: (ITechwolfIqResponse|null);

    /** TechwolfChatProtocol messageSync */
    messageSync?: (ITechwolfMessageSync[]|null);

    /** TechwolfChatProtocol messageRead */
    messageRead?: (ITechwolfMessageRead[]|null);

    /** TechwolfChatProtocol dataSync */
    dataSync?: (ITechwolfDataSync|null);

    /** TechwolfChatProtocol domain */
    domain?: (number|null);
}

/** Represents a TechwolfChatProtocol. */
export class TechwolfChatProtocol implements ITechwolfChatProtocol {

    /**
     * Constructs a new TechwolfChatProtocol.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfChatProtocol);

    /** TechwolfChatProtocol type. */
    public type: number;

    /** TechwolfChatProtocol version. */
    public version: string;

    /** TechwolfChatProtocol messages. */
    public messages: ITechwolfMessage[];

    /** TechwolfChatProtocol presence. */
    public presence?: (ITechwolfPresence|null);

    /** TechwolfChatProtocol iq. */
    public iq?: (ITechwolfIq|null);

    /** TechwolfChatProtocol iqResponse. */
    public iqResponse?: (ITechwolfIqResponse|null);

    /** TechwolfChatProtocol messageSync. */
    public messageSync: ITechwolfMessageSync[];

    /** TechwolfChatProtocol messageRead. */
    public messageRead: ITechwolfMessageRead[];

    /** TechwolfChatProtocol dataSync. */
    public dataSync?: (ITechwolfDataSync|null);

    /** TechwolfChatProtocol domain. */
    public domain: number;

    /**
     * Creates a new TechwolfChatProtocol instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfChatProtocol instance
     */
    public static create(properties?: ITechwolfChatProtocol): TechwolfChatProtocol;

    /**
     * Encodes the specified TechwolfChatProtocol message. Does not implicitly {@link TechwolfChatProtocol.verify|verify} messages.
     * @param message TechwolfChatProtocol message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfChatProtocol, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfChatProtocol message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfChatProtocol
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfChatProtocol;
}

/** Properties of a TechwolfRedEnvelope. */
export interface ITechwolfRedEnvelope {

    /** TechwolfRedEnvelope redId */
    redId: Long;

    /** TechwolfRedEnvelope redText */
    redText: string;

    /** TechwolfRedEnvelope redTitle */
    redTitle: string;

    /** TechwolfRedEnvelope clickUrl */
    clickUrl: string;
}

/** Represents a TechwolfRedEnvelope. */
export class TechwolfRedEnvelope implements ITechwolfRedEnvelope {

    /**
     * Constructs a new TechwolfRedEnvelope.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfRedEnvelope);

    /** TechwolfRedEnvelope redId. */
    public redId: Long;

    /** TechwolfRedEnvelope redText. */
    public redText: string;

    /** TechwolfRedEnvelope redTitle. */
    public redTitle: string;

    /** TechwolfRedEnvelope clickUrl. */
    public clickUrl: string;

    /**
     * Creates a new TechwolfRedEnvelope instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfRedEnvelope instance
     */
    public static create(properties?: ITechwolfRedEnvelope): TechwolfRedEnvelope;

    /**
     * Encodes the specified TechwolfRedEnvelope message. Does not implicitly {@link TechwolfRedEnvelope.verify|verify} messages.
     * @param message TechwolfRedEnvelope message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfRedEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfRedEnvelope message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfRedEnvelope
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfRedEnvelope;
}

/** Properties of a TechwolfOrderDetail. */
export interface ITechwolfOrderDetail {

    /** TechwolfOrderDetail title */
    title: string;

    /** TechwolfOrderDetail subTitle */
    subTitle: string;

    /** TechwolfOrderDetail url */
    url?: (string|null);

    /** TechwolfOrderDetail orderDetailEntryList */
    orderDetailEntryList?: (ITechwolfOrderDetailEntry[]|null);
}

/** Represents a TechwolfOrderDetail. */
export class TechwolfOrderDetail implements ITechwolfOrderDetail {

    /**
     * Constructs a new TechwolfOrderDetail.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfOrderDetail);

    /** TechwolfOrderDetail title. */
    public title: string;

    /** TechwolfOrderDetail subTitle. */
    public subTitle: string;

    /** TechwolfOrderDetail url. */
    public url: string;

    /** TechwolfOrderDetail orderDetailEntryList. */
    public orderDetailEntryList: ITechwolfOrderDetailEntry[];

    /**
     * Creates a new TechwolfOrderDetail instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfOrderDetail instance
     */
    public static create(properties?: ITechwolfOrderDetail): TechwolfOrderDetail;

    /**
     * Encodes the specified TechwolfOrderDetail message. Does not implicitly {@link TechwolfOrderDetail.verify|verify} messages.
     * @param message TechwolfOrderDetail message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfOrderDetail, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfOrderDetail message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfOrderDetail
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfOrderDetail;
}

/** Properties of a TechwolfOrderDetailItem. */
export interface ITechwolfOrderDetailItem {

    /** TechwolfOrderDetailItem name */
    name: string;

    /** TechwolfOrderDetailItem templateId */
    templateId: number;
}

/** Represents a TechwolfOrderDetailItem. */
export class TechwolfOrderDetailItem implements ITechwolfOrderDetailItem {

    /**
     * Constructs a new TechwolfOrderDetailItem.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfOrderDetailItem);

    /** TechwolfOrderDetailItem name. */
    public name: string;

    /** TechwolfOrderDetailItem templateId. */
    public templateId: number;

    /**
     * Creates a new TechwolfOrderDetailItem instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfOrderDetailItem instance
     */
    public static create(properties?: ITechwolfOrderDetailItem): TechwolfOrderDetailItem;

    /**
     * Encodes the specified TechwolfOrderDetailItem message. Does not implicitly {@link TechwolfOrderDetailItem.verify|verify} messages.
     * @param message TechwolfOrderDetailItem message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfOrderDetailItem, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfOrderDetailItem message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfOrderDetailItem
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfOrderDetailItem;
}

/** Properties of a TechwolfOrderDetailEntry. */
export interface ITechwolfOrderDetailEntry {

    /** TechwolfOrderDetailEntry key */
    key: ITechwolfOrderDetailItem;

    /** TechwolfOrderDetailEntry value */
    value: ITechwolfOrderDetailItem;
}

/** Represents a TechwolfOrderDetailEntry. */
export class TechwolfOrderDetailEntry implements ITechwolfOrderDetailEntry {

    /**
     * Constructs a new TechwolfOrderDetailEntry.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfOrderDetailEntry);

    /** TechwolfOrderDetailEntry key. */
    public key: ITechwolfOrderDetailItem;

    /** TechwolfOrderDetailEntry value. */
    public value: ITechwolfOrderDetailItem;

    /**
     * Creates a new TechwolfOrderDetailEntry instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfOrderDetailEntry instance
     */
    public static create(properties?: ITechwolfOrderDetailEntry): TechwolfOrderDetailEntry;

    /**
     * Encodes the specified TechwolfOrderDetailEntry message. Does not implicitly {@link TechwolfOrderDetailEntry.verify|verify} messages.
     * @param message TechwolfOrderDetailEntry message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfOrderDetailEntry, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfOrderDetailEntry message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfOrderDetailEntry
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfOrderDetailEntry;
}

/** Properties of a TechwolfUserSync. */
export interface ITechwolfUserSync {

    /** TechwolfUserSync uid */
    uid: Long;

    /** TechwolfUserSync identity */
    identity: number;

    /** TechwolfUserSync extraJson */
    extraJson?: (string|null);

    /** TechwolfUserSync userSource */
    userSource?: (number|null);
}

/** Represents a TechwolfUserSync. */
export class TechwolfUserSync implements ITechwolfUserSync {

    /**
     * Constructs a new TechwolfUserSync.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfUserSync);

    /** TechwolfUserSync uid. */
    public uid: Long;

    /** TechwolfUserSync identity. */
    public identity: number;

    /** TechwolfUserSync extraJson. */
    public extraJson: string;

    /** TechwolfUserSync userSource. */
    public userSource: number;

    /**
     * Creates a new TechwolfUserSync instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfUserSync instance
     */
    public static create(properties?: ITechwolfUserSync): TechwolfUserSync;

    /**
     * Encodes the specified TechwolfUserSync message. Does not implicitly {@link TechwolfUserSync.verify|verify} messages.
     * @param message TechwolfUserSync message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfUserSync, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfUserSync message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfUserSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfUserSync;
}

/** Properties of a TechwolfDataSync. */
export interface ITechwolfDataSync {

    /** TechwolfDataSync type */
    type: number;

    /** TechwolfDataSync userSync */
    userSync?: (ITechwolfUserSync|null);

    /** TechwolfDataSync groupSync */
    groupSync?: (ITechwolfGroupSync|null);
}

/** Represents a TechwolfDataSync. */
export class TechwolfDataSync implements ITechwolfDataSync {

    /**
     * Constructs a new TechwolfDataSync.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfDataSync);

    /** TechwolfDataSync type. */
    public type: number;

    /** TechwolfDataSync userSync. */
    public userSync?: (ITechwolfUserSync|null);

    /** TechwolfDataSync groupSync. */
    public groupSync?: (ITechwolfGroupSync|null);

    /**
     * Creates a new TechwolfDataSync instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfDataSync instance
     */
    public static create(properties?: ITechwolfDataSync): TechwolfDataSync;

    /**
     * Encodes the specified TechwolfDataSync message. Does not implicitly {@link TechwolfDataSync.verify|verify} messages.
     * @param message TechwolfDataSync message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfDataSync, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfDataSync message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfDataSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfDataSync;
}

/** Properties of a TechwolfSlice. */
export interface ITechwolfSlice {

    /** TechwolfSlice startIndex */
    startIndex: number;

    /** TechwolfSlice endIndex */
    endIndex: number;
}

/** Represents a TechwolfSlice. */
export class TechwolfSlice implements ITechwolfSlice {

    /**
     * Constructs a new TechwolfSlice.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfSlice);

    /** TechwolfSlice startIndex. */
    public startIndex: number;

    /** TechwolfSlice endIndex. */
    public endIndex: number;

    /**
     * Creates a new TechwolfSlice instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfSlice instance
     */
    public static create(properties?: ITechwolfSlice): TechwolfSlice;

    /**
     * Encodes the specified TechwolfSlice message. Does not implicitly {@link TechwolfSlice.verify|verify} messages.
     * @param message TechwolfSlice message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfSlice, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfSlice message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfSlice
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfSlice;
}

/** Properties of a UserExperience. */
export interface IUserExperience {

    /** UserExperience organization */
    organization: string;

    /** UserExperience occupation */
    occupation: string;

    /** UserExperience startDate */
    startDate?: (string|null);

    /** UserExperience endDate */
    endDate?: (string|null);

    /** UserExperience type */
    type: number;
}

/** Represents a UserExperience. */
export class UserExperience implements IUserExperience {

    /**
     * Constructs a new UserExperience.
     * @param [properties] Properties to set
     */
    constructor(properties?: IUserExperience);

    /** UserExperience organization. */
    public organization: string;

    /** UserExperience occupation. */
    public occupation: string;

    /** UserExperience startDate. */
    public startDate: string;

    /** UserExperience endDate. */
    public endDate: string;

    /** UserExperience type. */
    public type: number;

    /**
     * Creates a new UserExperience instance using the specified properties.
     * @param [properties] Properties to set
     * @returns UserExperience instance
     */
    public static create(properties?: IUserExperience): UserExperience;

    /**
     * Encodes the specified UserExperience message. Does not implicitly {@link UserExperience.verify|verify} messages.
     * @param message UserExperience message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: IUserExperience, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a UserExperience message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns UserExperience
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): UserExperience;
}

/** Properties of a TechwolfJobShare. */
export interface ITechwolfJobShare {

    /** TechwolfJobShare user */
    user: ITechwolfUser;

    /** TechwolfJobShare jobId */
    jobId: Long;

    /** TechwolfJobShare position */
    position: string;

    /** TechwolfJobShare salary */
    salary: string;

    /** TechwolfJobShare location */
    location?: (string|null);

    /** TechwolfJobShare company */
    company: string;

    /** TechwolfJobShare stage */
    stage?: (string|null);

    /** TechwolfJobShare experience */
    experience?: (string|null);

    /** TechwolfJobShare education */
    education?: (string|null);

    /** TechwolfJobShare url */
    url?: (string|null);

    /** TechwolfJobShare lid */
    lid?: (string|null);

    /** TechwolfJobShare price */
    price?: (string|null);

    /** TechwolfJobShare description */
    description?: (string|null);
}

/** Represents a TechwolfJobShare. */
export class TechwolfJobShare implements ITechwolfJobShare {

    /**
     * Constructs a new TechwolfJobShare.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfJobShare);

    /** TechwolfJobShare user. */
    public user: ITechwolfUser;

    /** TechwolfJobShare jobId. */
    public jobId: Long;

    /** TechwolfJobShare position. */
    public position: string;

    /** TechwolfJobShare salary. */
    public salary: string;

    /** TechwolfJobShare location. */
    public location: string;

    /** TechwolfJobShare company. */
    public company: string;

    /** TechwolfJobShare stage. */
    public stage: string;

    /** TechwolfJobShare experience. */
    public experience: string;

    /** TechwolfJobShare education. */
    public education: string;

    /** TechwolfJobShare url. */
    public url: string;

    /** TechwolfJobShare lid. */
    public lid: string;

    /** TechwolfJobShare price. */
    public price: string;

    /** TechwolfJobShare description. */
    public description: string;

    /**
     * Creates a new TechwolfJobShare instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfJobShare instance
     */
    public static create(properties?: ITechwolfJobShare): TechwolfJobShare;

    /**
     * Encodes the specified TechwolfJobShare message. Does not implicitly {@link TechwolfJobShare.verify|verify} messages.
     * @param message TechwolfJobShare message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfJobShare, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfJobShare message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfJobShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfJobShare;
}

/** Properties of a TechwolfResumeShare. */
export interface ITechwolfResumeShare {

    /** TechwolfResumeShare user */
    user: ITechwolfUser;

    /** TechwolfResumeShare expectId */
    expectId: Long;

    /** TechwolfResumeShare position */
    position: string;

    /** TechwolfResumeShare salary */
    salary: string;

    /** TechwolfResumeShare location */
    location?: (string|null);

    /** TechwolfResumeShare applyStatus */
    applyStatus?: (string|null);

    /** TechwolfResumeShare age */
    age?: (string|null);

    /** TechwolfResumeShare experience */
    experience?: (string|null);

    /** TechwolfResumeShare education */
    education?: (string|null);

    /** TechwolfResumeShare url */
    url?: (string|null);

    /** TechwolfResumeShare lid */
    lid?: (string|null);

    /** TechwolfResumeShare gender */
    gender?: (number|null);

    /** TechwolfResumeShare blurred */
    blurred?: (boolean|null);

    /** TechwolfResumeShare source */
    source?: (number|null);
}

/** Represents a TechwolfResumeShare. */
export class TechwolfResumeShare implements ITechwolfResumeShare {

    /**
     * Constructs a new TechwolfResumeShare.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfResumeShare);

    /** TechwolfResumeShare user. */
    public user: ITechwolfUser;

    /** TechwolfResumeShare expectId. */
    public expectId: Long;

    /** TechwolfResumeShare position. */
    public position: string;

    /** TechwolfResumeShare salary. */
    public salary: string;

    /** TechwolfResumeShare location. */
    public location: string;

    /** TechwolfResumeShare applyStatus. */
    public applyStatus: string;

    /** TechwolfResumeShare age. */
    public age: string;

    /** TechwolfResumeShare experience. */
    public experience: string;

    /** TechwolfResumeShare education. */
    public education: string;

    /** TechwolfResumeShare url. */
    public url: string;

    /** TechwolfResumeShare lid. */
    public lid: string;

    /** TechwolfResumeShare gender. */
    public gender: number;

    /** TechwolfResumeShare blurred. */
    public blurred: boolean;

    /** TechwolfResumeShare source. */
    public source: number;

    /**
     * Creates a new TechwolfResumeShare instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfResumeShare instance
     */
    public static create(properties?: ITechwolfResumeShare): TechwolfResumeShare;

    /**
     * Encodes the specified TechwolfResumeShare message. Does not implicitly {@link TechwolfResumeShare.verify|verify} messages.
     * @param message TechwolfResumeShare message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfResumeShare, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfResumeShare message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfResumeShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfResumeShare;
}

/** Properties of an AtInfo. */
export interface IAtInfo {

    /** AtInfo flag */
    flag: number;

    /** AtInfo uids */
    uids?: (Long[]|null);
}

/** Represents an AtInfo. */
export class AtInfo implements IAtInfo {

    /**
     * Constructs a new AtInfo.
     * @param [properties] Properties to set
     */
    constructor(properties?: IAtInfo);

    /** AtInfo flag. */
    public flag: number;

    /** AtInfo uids. */
    public uids: Long[];

    /**
     * Creates a new AtInfo instance using the specified properties.
     * @param [properties] Properties to set
     * @returns AtInfo instance
     */
    public static create(properties?: IAtInfo): AtInfo;

    /**
     * Encodes the specified AtInfo message. Does not implicitly {@link AtInfo.verify|verify} messages.
     * @param message AtInfo message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: IAtInfo, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes an AtInfo message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns AtInfo
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): AtInfo;
}

/** Properties of a TechwolfGroupSync. */
export interface ITechwolfGroupSync {

    /** TechwolfGroupSync gid */
    gid: Long;

    /** TechwolfGroupSync version */
    version?: (number|null);

    /** TechwolfGroupSync encGid */
    encGid?: (string|null);
}

/** Represents a TechwolfGroupSync. */
export class TechwolfGroupSync implements ITechwolfGroupSync {

    /**
     * Constructs a new TechwolfGroupSync.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfGroupSync);

    /** TechwolfGroupSync gid. */
    public gid: Long;

    /** TechwolfGroupSync version. */
    public version: number;

    /** TechwolfGroupSync encGid. */
    public encGid: string;

    /**
     * Creates a new TechwolfGroupSync instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfGroupSync instance
     */
    public static create(properties?: ITechwolfGroupSync): TechwolfGroupSync;

    /**
     * Encodes the specified TechwolfGroupSync message. Does not implicitly {@link TechwolfGroupSync.verify|verify} messages.
     * @param message TechwolfGroupSync message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfGroupSync, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfGroupSync message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfGroupSync
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfGroupSync;
}

/** Properties of a TechwolfSticker. */
export interface ITechwolfSticker {

    /** TechwolfSticker sid */
    sid: Long;

    /** TechwolfSticker packId */
    packId?: (Long|null);

    /** TechwolfSticker image */
    image?: (ITechwolfImage|null);

    /** TechwolfSticker format */
    format?: (string|null);

    /** TechwolfSticker name */
    name?: (string|null);
}

/** Represents a TechwolfSticker. */
export class TechwolfSticker implements ITechwolfSticker {

    /**
     * Constructs a new TechwolfSticker.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfSticker);

    /** TechwolfSticker sid. */
    public sid: Long;

    /** TechwolfSticker packId. */
    public packId: Long;

    /** TechwolfSticker image. */
    public image?: (ITechwolfImage|null);

    /** TechwolfSticker format. */
    public format: string;

    /** TechwolfSticker name. */
    public name: string;

    /**
     * Creates a new TechwolfSticker instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfSticker instance
     */
    public static create(properties?: ITechwolfSticker): TechwolfSticker;

    /**
     * Encodes the specified TechwolfSticker message. Does not implicitly {@link TechwolfSticker.verify|verify} messages.
     * @param message TechwolfSticker message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfSticker, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfSticker message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfSticker
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfSticker;
}

/** Properties of a TechwolfChatShare. */
export interface ITechwolfChatShare {

    /** TechwolfChatShare shareId */
    shareId: Long;

    /** TechwolfChatShare title */
    title: string;

    /** TechwolfChatShare records */
    records?: (string[]|null);

    /** TechwolfChatShare bottomText */
    bottomText?: (string|null);

    /** TechwolfChatShare url */
    url?: (string|null);

    /** TechwolfChatShare from */
    from: ITechwolfUser;

    /** TechwolfChatShare to */
    to: ITechwolfUser;

    /** TechwolfChatShare user */
    user: ITechwolfUser;
}

/** Represents a TechwolfChatShare. */
export class TechwolfChatShare implements ITechwolfChatShare {

    /**
     * Constructs a new TechwolfChatShare.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfChatShare);

    /** TechwolfChatShare shareId. */
    public shareId: Long;

    /** TechwolfChatShare title. */
    public title: string;

    /** TechwolfChatShare records. */
    public records: string[];

    /** TechwolfChatShare bottomText. */
    public bottomText: string;

    /** TechwolfChatShare url. */
    public url: string;

    /** TechwolfChatShare from. */
    public from: ITechwolfUser;

    /** TechwolfChatShare to. */
    public to: ITechwolfUser;

    /** TechwolfChatShare user. */
    public user: ITechwolfUser;

    /**
     * Creates a new TechwolfChatShare instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfChatShare instance
     */
    public static create(properties?: ITechwolfChatShare): TechwolfChatShare;

    /**
     * Encodes the specified TechwolfChatShare message. Does not implicitly {@link TechwolfChatShare.verify|verify} messages.
     * @param message TechwolfChatShare message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfChatShare, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfChatShare message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfChatShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfChatShare;
}

/** Properties of a TechwolfInterviewShare. */
export interface ITechwolfInterviewShare {

    /** TechwolfInterviewShare interviewId */
    interviewId: Long;

    /** TechwolfInterviewShare user */
    user: ITechwolfUser;

    /** TechwolfInterviewShare title */
    title: string;

    /** TechwolfInterviewShare bottomText */
    bottomText: string;

    /** TechwolfInterviewShare url */
    url?: (string|null);

    /** TechwolfInterviewShare interviewTime */
    interviewTime?: (string|null);

    /** TechwolfInterviewShare interviewAddress */
    interviewAddress?: (string|null);

    /** TechwolfInterviewShare jobName */
    jobName?: (string|null);
}

/** Represents a TechwolfInterviewShare. */
export class TechwolfInterviewShare implements ITechwolfInterviewShare {

    /**
     * Constructs a new TechwolfInterviewShare.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfInterviewShare);

    /** TechwolfInterviewShare interviewId. */
    public interviewId: Long;

    /** TechwolfInterviewShare user. */
    public user: ITechwolfUser;

    /** TechwolfInterviewShare title. */
    public title: string;

    /** TechwolfInterviewShare bottomText. */
    public bottomText: string;

    /** TechwolfInterviewShare url. */
    public url: string;

    /** TechwolfInterviewShare interviewTime. */
    public interviewTime: string;

    /** TechwolfInterviewShare interviewAddress. */
    public interviewAddress: string;

    /** TechwolfInterviewShare jobName. */
    public jobName: string;

    /**
     * Creates a new TechwolfInterviewShare instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfInterviewShare instance
     */
    public static create(properties?: ITechwolfInterviewShare): TechwolfInterviewShare;

    /**
     * Encodes the specified TechwolfInterviewShare message. Does not implicitly {@link TechwolfInterviewShare.verify|verify} messages.
     * @param message TechwolfInterviewShare message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfInterviewShare, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfInterviewShare message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfInterviewShare
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfInterviewShare;
}

/** Properties of a TechwolfListItem. */
export interface ITechwolfListItem {

    /** TechwolfListItem title */
    title?: (string|null);

    /** TechwolfListItem icon */
    icon?: (number|null);
}

/** Represents a TechwolfListItem. */
export class TechwolfListItem implements ITechwolfListItem {

    /**
     * Constructs a new TechwolfListItem.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfListItem);

    /** TechwolfListItem title. */
    public title: string;

    /** TechwolfListItem icon. */
    public icon: number;

    /**
     * Creates a new TechwolfListItem instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfListItem instance
     */
    public static create(properties?: ITechwolfListItem): TechwolfListItem;

    /**
     * Encodes the specified TechwolfListItem message. Does not implicitly {@link TechwolfListItem.verify|verify} messages.
     * @param message TechwolfListItem message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfListItem, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfListItem message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfListItem
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfListItem;
}

/** Properties of a TechwolfListCard. */
export interface ITechwolfListCard {

    /** TechwolfListCard title */
    title?: (string|null);

    /** TechwolfListCard items */
    items?: (ITechwolfListItem[]|null);

    /** TechwolfListCard pageSize */
    pageSize?: (number|null);
}

/** Represents a TechwolfListCard. */
export class TechwolfListCard implements ITechwolfListCard {

    /**
     * Constructs a new TechwolfListCard.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfListCard);

    /** TechwolfListCard title. */
    public title: string;

    /** TechwolfListCard items. */
    public items: ITechwolfListItem[];

    /** TechwolfListCard pageSize. */
    public pageSize: number;

    /**
     * Creates a new TechwolfListCard instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfListCard instance
     */
    public static create(properties?: ITechwolfListCard): TechwolfListCard;

    /**
     * Encodes the specified TechwolfListCard message. Does not implicitly {@link TechwolfListCard.verify|verify} messages.
     * @param message TechwolfListCard message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfListCard, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfListCard message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfListCard
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfListCard;
}

/** Properties of a TechwolfStar. */
export interface ITechwolfStar {

    /** TechwolfStar starId */
    starId: Long;

    /** TechwolfStar starDesc */
    starDesc?: (string|null);

    /** TechwolfStar options */
    options?: (ITechwolfListItem[]|null);
}

/** Represents a TechwolfStar. */
export class TechwolfStar implements ITechwolfStar {

    /**
     * Constructs a new TechwolfStar.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfStar);

    /** TechwolfStar starId. */
    public starId: Long;

    /** TechwolfStar starDesc. */
    public starDesc: string;

    /** TechwolfStar options. */
    public options: ITechwolfListItem[];

    /**
     * Creates a new TechwolfStar instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfStar instance
     */
    public static create(properties?: ITechwolfStar): TechwolfStar;

    /**
     * Encodes the specified TechwolfStar message. Does not implicitly {@link TechwolfStar.verify|verify} messages.
     * @param message TechwolfStar message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfStar, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfStar message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfStar
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfStar;
}

/** Properties of a TechwolfStarRate. */
export interface ITechwolfStarRate {

    /** TechwolfStarRate title */
    title?: (string|null);

    /** TechwolfStarRate stars */
    stars?: (ITechwolfStar[]|null);

    /** TechwolfStarRate rateStatus */
    rateStatus: number;

    /** TechwolfStarRate rateStar */
    rateStar?: (ITechwolfStar|null);

    /** TechwolfStarRate submitButton */
    submitButton?: (ITechwolfButton|null);
}

/** Represents a TechwolfStarRate. */
export class TechwolfStarRate implements ITechwolfStarRate {

    /**
     * Constructs a new TechwolfStarRate.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfStarRate);

    /** TechwolfStarRate title. */
    public title: string;

    /** TechwolfStarRate stars. */
    public stars: ITechwolfStar[];

    /** TechwolfStarRate rateStatus. */
    public rateStatus: number;

    /** TechwolfStarRate rateStar. */
    public rateStar?: (ITechwolfStar|null);

    /** TechwolfStarRate submitButton. */
    public submitButton?: (ITechwolfButton|null);

    /**
     * Creates a new TechwolfStarRate instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfStarRate instance
     */
    public static create(properties?: ITechwolfStarRate): TechwolfStarRate;

    /**
     * Encodes the specified TechwolfStarRate message. Does not implicitly {@link TechwolfStarRate.verify|verify} messages.
     * @param message TechwolfStarRate message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfStarRate, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfStarRate message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfStarRate
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfStarRate;
}

/** Properties of a TechwolfFrame. */
export interface ITechwolfFrame {

    /** TechwolfFrame href */
    href: string;
}

/** Represents a TechwolfFrame. */
export class TechwolfFrame implements ITechwolfFrame {

    /**
     * Constructs a new TechwolfFrame.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfFrame);

    /** TechwolfFrame href. */
    public href: string;

    /**
     * Creates a new TechwolfFrame instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfFrame instance
     */
    public static create(properties?: ITechwolfFrame): TechwolfFrame;

    /**
     * Encodes the specified TechwolfFrame message. Does not implicitly {@link TechwolfFrame.verify|verify} messages.
     * @param message TechwolfFrame message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfFrame, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfFrame message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfFrame
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfFrame;
}

/** Properties of a TechwolfMultiImage. */
export interface ITechwolfMultiImage {

    /** TechwolfMultiImage images */
    images?: (ITechwolfImageInfo[]|null);
}

/** Represents a TechwolfMultiImage. */
export class TechwolfMultiImage implements ITechwolfMultiImage {

    /**
     * Constructs a new TechwolfMultiImage.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITechwolfMultiImage);

    /** TechwolfMultiImage images. */
    public images: ITechwolfImageInfo[];

    /**
     * Creates a new TechwolfMultiImage instance using the specified properties.
     * @param [properties] Properties to set
     * @returns TechwolfMultiImage instance
     */
    public static create(properties?: ITechwolfMultiImage): TechwolfMultiImage;

    /**
     * Encodes the specified TechwolfMultiImage message. Does not implicitly {@link TechwolfMultiImage.verify|verify} messages.
     * @param message TechwolfMultiImage message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITechwolfMultiImage, writer?: $protobuf.Writer): $protobuf.Writer;

    /**
     * Decodes a TechwolfMultiImage message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns TechwolfMultiImage
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): TechwolfMultiImage;
}
