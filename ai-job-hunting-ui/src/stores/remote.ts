import {LoginStore, UserStore} from "./index";
import {
    applyPreferenceDefaults,
    PreferenceConfig,
} from "./types";
import {
    SAFE_DEFAULT_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_DEFAULT_PUSH_INTERVAL_SECONDS,
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from "../platform/safetyLimits";
import {ServerStore} from "./server";
import {TampermonkeyApi} from "../platform/utils";
import logging from "../logging";
import {silentlyLogin} from "../utils/tools"
import axios from "../axios";
import {LogRecorder} from "../logging/record";

const logRecorder = new LogRecorder();

const USER_CONFIG_CACHE_TTL_MS = 15_000;
let activeUserLoad: Promise<void> | null = null;

/**
 * 老版脚本把用户配置放在页面 localStorage；WXT 的隔离存储无法直接继承它。
 * 只在服务器尚未保存偏好时回填，且不自动写回服务器，避免无意覆盖新设置。
 */
function readLegacyUserPreference(): Partial<PreferenceConfig> | null {
    try {
        const raw = localStorage.getItem("ai-job-user")
        if (!raw) return null
        const legacyUser = JSON.parse(raw)
        const preference = legacyUser?.preference
        return preference && typeof preference === "object" && Object.keys(preference).length > 0
            ? preference as Partial<PreferenceConfig>
            : null
    } catch (_) {
        // 历史数据损坏时继续使用服务器配置，不阻断助手启动。
        return null
    }
}

function applyUserConfig(userStore: ReturnType<typeof UserStore>, user: any) {
    const serverUser = user && typeof user === "object" ? user : {}
    const serverPreference = serverUser.preference
    const legacyPreference = readLegacyUserPreference()
    const useLegacyPreference = (!serverPreference || Object.keys(serverPreference).length === 0)
        && legacyPreference !== null

    userStore.user = {
        ...serverUser,
        preference: useLegacyPreference
            ? {...legacyPreference, ...serverPreference}
            : serverPreference,
    }
    if (!userStore?.user) {
        throw new Error("用户偏好配置为空")
    }
    userStore.user.preference = applyPreferenceDefaults(userStore.user.preference)
    userStore.user.preference.pi = Math.max(
        SAFE_MIN_PUSH_INTERVAL_SECONDS,
        Number(userStore.user.preference.pi) || SAFE_DEFAULT_PUSH_INTERVAL_SECONDS,
    )
    userStore.user.preference.npi = Math.max(
        SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
        Number(userStore.user.preference.npi) || SAFE_DEFAULT_NEXT_PAGE_INTERVAL_SECONDS,
    )
    if (useLegacyPreference) {
        logRecorder.info("已从旧版页面本地数据恢复偏好；请在偏好设置页确认后手动保存")
    }
}

export function userRemoteLoad(forceRefresh = false): Promise<void> {
    logRecorder.info("加载用户偏好配置")
    const userStore = UserStore()
    const loginStore = LoginStore();
    const serverStore = ServerStore();

    if (loginStore.loginFailStatus){
        return Promise.resolve();
    }

    const mirrorKey = serverStore.getMirrorKey('user_config')
    const mirrorUpdatedAtKey = `${mirrorKey}:updated_at`
    const mirrorData = TampermonkeyApi.GmGetValue(mirrorKey, null)
    const mirrorUpdatedAt = Number(TampermonkeyApi.GmGetValue(mirrorUpdatedAtKey, 0))

    // Userscript may be injected repeatedly during BOSS navigation or in another tab.
    // Reuse the server-scoped mirror briefly so these injections do not hammer userinfo.
    if (!forceRefresh && mirrorData && Date.now() - mirrorUpdatedAt < USER_CONFIG_CACHE_TTL_MS) {
        applyUserConfig(userStore, mirrorData)
        logRecorder.info("使用短时用户配置镜像，跳过重复请求")
        return Promise.resolve()
    }

    if (activeUserLoad) {
        return activeUserLoad
    }

    // 先尝试静默登录
    activeUserLoad = silentlyLogin("").then(_ => {
        logging.debug("调用接口加载用户偏好配置")
        return axios.post("/api/user/userinfo", {})
    }).then(resp => {
        applyUserConfig(userStore, resp?.data?.data)

        // 成功获取数据，同时存入特定服务器镜像和全局最新镜像
        const globalMirrorKey = serverStore.getGlobalMirrorKey('user_config')
        TampermonkeyApi.GmSetValue(mirrorKey, userStore.user)
        TampermonkeyApi.GmSetValue(mirrorUpdatedAtKey, Date.now())
        TampermonkeyApi.GmSetValue(globalMirrorKey, userStore.user)

        logRecorder.info("从服务器加载配置成功")
    }).catch(error => {
        logRecorder.warn("从服务器加载配置失败，尝试读取本地镜像", error.message)

        // 1. 优先尝试从当前服务器的镜像加载
        let mirrorData = TampermonkeyApi.GmGetValue(mirrorKey, null)

        // 2. 如果当前服务器没有镜像，尝试从全局最新镜像加载
        if (!mirrorData) {
            const globalMirrorKey = serverStore.getGlobalMirrorKey('user_config')
            mirrorData = TampermonkeyApi.GmGetValue(globalMirrorKey, null)
            if (mirrorData) {
                logRecorder.info("已从全局最新镜像回退加载配置")
            }
        }

        if (mirrorData) {
            applyUserConfig(userStore, mirrorData)
            logRecorder.info("已加载本地镜像配置 (离线模式)")
        } else {
            loginStore.loginFail()
            logRecorder.error("加载配置失败：无服务器数据且无本地镜像")
        }
    })
.finally(() => {
        if (!userStore.user.preference) {
            userStore.user.preference = {} as PreferenceConfig
        }
        userStore.user.preference = applyPreferenceDefaults(userStore.user.preference)
        activeUserLoad = null
    })

    return activeUserLoad
}
