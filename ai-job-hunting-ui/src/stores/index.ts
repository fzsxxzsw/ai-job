import {reactive, ref} from 'vue'
import {defineStore} from 'pinia'
import {applyPreferenceDefaults, PreferenceConfig, User} from "./types";
import logger from "../logging";
import platform, {PlatformTypeEnum} from "../platform/platform";
import {TampermonkeyApi} from "../platform/utils";
import {nextSharedDailyCounterValue} from "../platform/bossDailyLimit";

export const pushResultCount = defineStore('pushResultCount', () => {
    const notMatchCount = ref(0)
    let successCountKey = TampermonkeyApi.PUSH_SUCCESS_COUNT
    let failCountKey = TampermonkeyApi.PUSH_FAIL_COUNT
    const successCount = ref(Number(TampermonkeyApi.GmGetValue(successCountKey, 0)) || 0)
    const onceSuccessCount = ref(0)
    const failCount = ref(Number(TampermonkeyApi.GmGetValue(failCountKey, 0)) || 0)

    function notMatchIncr() {
        notMatchCount.value++
    }

    function successIncr() {
        const currentKey = TampermonkeyApi.PUSH_SUCCESS_COUNT
        if (currentKey !== successCountKey) {
            successCountKey = currentKey
            successCount.value = Number(TampermonkeyApi.GmGetValue(currentKey, 0)) || 0
        }
        successCount.value = nextSharedDailyCounterValue(
            successCount.value,
            TampermonkeyApi.GmGetValue(currentKey, 0),
        )
        onceSuccessCount.value++
        TampermonkeyApi.GmSetValue(currentKey, successCount.value)
    }

    function failIncr() {
        const currentKey = TampermonkeyApi.PUSH_FAIL_COUNT
        if (currentKey !== failCountKey) {
            failCountKey = currentKey
            failCount.value = Number(TampermonkeyApi.GmGetValue(currentKey, 0)) || 0
        }
        failCount.value = nextSharedDailyCounterValue(
            failCount.value,
            TampermonkeyApi.GmGetValue(currentKey, 0),
        )
        TampermonkeyApi.GmSetValue(currentKey, failCount.value)
    }

    function clearOnceSuccessCount() {
        onceSuccessCount.value = 0
    }

    return {
        notMatchIncr,
        successIncr,
        notMatchCount,
        successCount,
        failCount,
        failIncr,
        onceSuccessCount,
        clearOnceSuccessCount
    }
})

export const UserStore = defineStore('ai-user', () => {

    const platformType = ref<number>()
    const user = reactive<User>(getLocalUser())
    return {
        user,
        platformType
    };
})


export const LoginStore = defineStore('LoginStore', () => {

    const login = ref<false | true>()
    const loginFailStatus = ref<false | true>()

    function loginSuccess() {
        login.value = true
    }

    function loginFail() {
        loginFailStatus.value = true
    }

    return {
        login, loginSuccess, loginFailStatus, loginFail
    };
})


function getLocalUser(): User {
    const map = new Map<PlatformTypeEnum, PreferenceConfig>();
    let jsonData = localStorage.getItem("ai-job-user");
    if (jsonData === null) {
        jsonData = '{"phone":"","email":"","preference":{},"preferenceMap":{}}'
    }
    let user = JSON.parse(jsonData) as User;
    user.preference = applyPreferenceDefaults(user.preference)
    logger.debug("获取本地用户配置", user)
    return user;
}


export const ProductStore = defineStore('ProductStore', () => {

    const showProduct = ref<false | true>(false)

    function setShowProduct(show: boolean) {
        showProduct.value = show
    }

    return {
        showProduct, setShowProduct
    };
})
