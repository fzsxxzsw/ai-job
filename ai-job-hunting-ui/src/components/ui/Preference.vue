<template>
    <el-form
        ref="ruleFormRef"
        :model="userStore.user"
        :rules="rules as FormRules<RuleForm>"
        label-position="right"
        label-width="auto"
        class="form-preference"
        size="large"
        status-icon>

        <div>
            <div v-if="Tools.window.location.href.includes('job-recommend')">
                <el-text class="mx-1 top-title" type="danger">!!!请前往顶部【搜索】按钮所在页面保存偏好设置!!!</el-text>
                <br/>
                <br/>
            </div>
            <el-text class="mx-1 top-title" type="warning">账号信息</el-text>
            <div style="display: flex;margin-top: 10px">
                <el-form-item label="手机号" prop="phone" style="margin-left: -6px;">
                    <el-input v-model="userStore.user.phone"/>
                </el-form-item>

                <el-form-item label="通知邮箱" prop="email">
                    <el-input v-model="userStore.user.email"/>
                </el-form-item>
            </div>

            <el-text class="mx-1 top-title" type="warning">投递设置</el-text>
            <div style="display: flex;margin-top: 10px">
                <el-form-item prop="companyInclude" style="margin-left: -40px;">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.cniE" label="" size="large"/>
                        公司名包含
                    </template>
                    <el-select v-model="userStore.user.preference.cni"
                               multiple
                               filterable
                               remote
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="公司名包含"
                               style="width: 240px">
                        <el-option v-for="(item,inx) in ['请输入公司名']"
                                   :key="inx"
                                   :label="item"
                                   :value="item"/>
                    </el-select>
                </el-form-item>

                <el-form-item label="公司名排除" prop="companyExclude">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.cneE" label="" size="large"/>
                        公司名排除&nbsp;&nbsp;&nbsp;
                    </template>
                    <el-select v-model="visibleCompanyExclusions"
                               multiple
                               filterable
                               allow-create
                               clearable
                               :reserve-keyword="false"
                               placeholder="输入公司关键词后按 Enter"
                               style="width: 240px"/>
                </el-form-item>
            </div>

            <div style="display: flex">
                <el-form-item label="工作名包含" style="margin-left: -40px;" prop="jobNameInclude">
                    <template #label>
                        岗位名规则
                    </template>
                    <el-select v-model="userStore.user.preference.jobTitleMatchMode"
                               style="width: 150px; margin-right: 8px">
                        <el-option label="必须匹配（推荐）" value="required"/>
                        <el-option label="仅作为偏好" value="prefer"/>
                        <el-option label="关闭规则" value="off"/>
                    </el-select>
                    <el-select v-model="userStore.user.preference.jni"
                               multiple
                               filterable
                               remote
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="工作名包含"
                               style="width: 300px">
                        <el-option v-for="(item,inx) in ['请输入工作名']"
                                   :key="inx"
                                   :label="item"
                                   :value="item"/>
                    </el-select>
                </el-form-item>

                <el-form-item label="工作名排除" prop="jobContentExclude">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.jneE" label="" size="large"/>
                        工作名排除&nbsp;&nbsp;&nbsp;
                    </template>
                    <el-select v-model="userStore.user.preference.jne"
                               multiple
                               filterable
                               remote
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="工作名排除"
                               style="width: 240px">
                        <el-option v-for="(item,inx) in ['请输入岗位名称']"
                                   :key="inx"
                                   :label="item"
                                   :value="item"/>
                    </el-select>
                </el-form-item>
            </div>

            <div style="display: flex">
                <el-form-item label="工作内容包含" style="margin-left: -40px;" prop="jobContentInclude">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.jciE" label="" size="large"/>
                        &nbsp;&nbsp;&nbsp;&nbsp;内容包含
                    </template>
                    <el-select v-model="userStore.user.preference.jci"
                               multiple
                               filterable
                               remote
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="工作内容包含"
                               style="width: 240px">
                        <el-option v-for="(item,inx) in ['请输入工作内容']"
                                   :key="inx"
                                   :label="item"
                                   :value="item"/>
                    </el-select>
                </el-form-item>

                <el-form-item label="工作内容排除" prop="jobContentExclude">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.jceE" label="" size="large"/>
                        工作内容排除
                    </template>
                    <el-select v-model="userStore.user.preference.jce"
                               multiple
                               filterable
                               remote
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="工作内容排除"
                               style="width: 240px">
                        <el-option v-for="(item,inx) in ['请输入工作内容字符串']"
                                   :key="inx"
                                   :label="item"
                                   :value="item"/>
                    </el-select>
                </el-form-item>
            </div>

            <!--            <div class="form-bottom">-->
            <div style="display: flex">
                <div style="display: flex;height: 40px">
                    <span style="line-height: 40px; margin-right: 8px; white-space: nowrap">薪资硬范围</span>
                    <el-input class="input-opt"
                              v-model="userStore.user.preference.sr"
                              style="width: 324px"
                              placeholder="超出不投，例如 13-18">
                        <template #prepend>
                            <el-select v-model="userStore.user.preference.srT" placeholder="月薪(k)"
                                       style="width: 100px">
                                <el-option label="月薪(k)" value="1"/>
                                <el-option label="日薪" value="2"/>
                            </el-select>
                        </template>
                    </el-input>
                </div>

                <el-form-item label="公司规模范围" prop="jobContentExclude" style="margin-left: 0;">
                    <template #label>
                        <el-checkbox v-model="userStore.user.preference.csrE" label="" size="large"/>
                        公司规模范围
                    </template>
                    <el-input v-model="userStore.user.preference.csr" placeholder="公司规模范围 例:10-5000"
                              style="width: 242px"/>
                </el-form-item>
            </div>

            <div class="benefit-preference-row">
                <el-form-item label="周末双休">
                    <el-select v-model="userStore.user.preference.weekendMode" style="width: 180px">
                        <el-option label="优先投递（推荐）" value="prefer"/>
                        <el-option label="必须明确标注" value="required"/>
                        <el-option label="关闭偏好" value="off"/>
                    </el-select>
                </el-form-item>
                <el-form-item label="五险一金">
                    <el-select v-model="userStore.user.preference.insuranceMode" style="width: 180px">
                        <el-option label="优先投递（推荐）" value="prefer"/>
                        <el-option label="必须明确标注" value="required"/>
                        <el-option label="关闭偏好" value="off"/>
                    </el-select>
                </el-form-item>
                <el-text type="info" class="benefit-preference-tip">
                    “优先”会先处理已明确标注的岗位；“必须”会过滤未明确标注的岗位。
                </el-text>
            </div>

            <div class="commute-preference-row">
                <el-form-item label="通勤位置">
                    <el-select v-model="userStore.user.preference.commuteLocations"
                               multiple
                               filterable
                               allow-create
                               default-first-option
                               :reserve-keyword="false"
                               placeholder="例如：所在城区、附近商圈、地铁线路"
                               style="width: 420px">
                    </el-select>
                </el-form-item>
                <el-form-item label="位置要求">
                    <el-select v-model="userStore.user.preference.commuteMode" style="width: 180px">
                        <el-option label="优先附近岗位（推荐）" value="prefer"/>
                        <el-option label="必须匹配位置" value="required"/>
                        <el-option label="关闭偏好" value="off"/>
                    </el-select>
                </el-form-item>
                <el-text type="warning" class="commute-preference-tip">
                    为保护隐私，建议填写附近商圈、地铁站或行政区，不要填写家庭门牌号。
                </el-text>
            </div>

            <div class="resume-match-row">
                <el-form-item label="简历-JD本地匹配">
                    <el-checkbox v-model="userStore.user.preference.resumeMatchE" size="large">
                        启用匹配评分
                    </el-checkbox>
                </el-form-item>
                <el-form-item label="匹配参考线">
                    <el-input-number v-model="userStore.user.preference.resumeMatchMinScore"
                                     :min="0" :max="100" :step="5" :disabled="!userStore.user.preference.resumeMatchE"/>
                </el-form-item>
                <el-text type="primary" class="resume-match-tip">
                    本地代码会按“已验证岗位名 + 结构化技能 + JD硬性/优先条件”分层加权，并给出命中、缺口和置信度；不调用大模型，也不会仅因分数低而跳过。只有下方附加AI筛选条件启用时才会请求大模型。
                </el-text>
            </div>

            <el-form-item label="附加AI筛选条件" prop="aiFilter">
                <template #label>
                    <el-checkbox v-model="userStore.user.preference.afE" label="" size="large"/>
                    <el-tooltip effect="dark" raw-content content="
    在简历-JD评分之外追加自然语言要求。<br/>例如：不接受外包、长期出差或频繁夜班。
    " placement="bottom">
                    附加AI筛选条件
                    </el-tooltip>
                </template>
                <el-input type="textarea" v-model="userStore.user.preference.af"
                          placeholder="选填：例如不接受外包、长期出差或频繁夜班"/>
            </el-form-item>

            <el-form-item label="首次沟通消息" prop="jobContentExclude">
                <el-select v-model="userStore.user.preference.greetingDeliveryMode" style="width: 100%; margin-bottom: 8px">
                    <el-option label="平台默认招呼（纯规则投递）" value="platform-default"/>
                    <el-option label="自定义招呼（后台补发，不阻塞投递）" value="custom-queued"/>
                    <el-option label="自定义招呼（严格确认，通道未就绪时不投递）" value="custom-required"/>
                </el-select>
                <el-alert v-if="userStore.user.preference.greetingDeliveryMode === 'platform-default'"
                          title="纯规则投递不依赖 AI 或聊天通道；首次沟通由 BOSS 平台处理。"
                          type="info" :closable="false" style="margin-bottom: 8px"/>
                <el-alert v-else-if="userStore.user.preference.greetingDeliveryMode === 'custom-queued'"
                          title="聊天通道暂时不可用时，招呼语会去重入队后后台补发，不会卡住岗位投递。"
                          type="warning" :closable="false" style="margin-bottom: 8px"/>
                <el-input v-if="userStore.user.preference.greetingDeliveryMode !== 'platform-default'"
                          type="textarea" v-model="userStore.user.preference.cg"/>
                <el-button v-if="userStore.user.preference.greetingDeliveryMode !== 'platform-default'"
                           size="small" type="primary" @click="generateGreet" :disabled="isGenerating">
                    AI生成招呼语
                </el-button>
            </el-form-item>

            <el-form-item label="回复后发送图片简历" prop="jobContentExclude" class="form-item-upload" style="margin-left: 0;">
                <template #label>
                    <el-checkbox v-model="userStore.user.preference.cIE" label="" size="large"/>
                    双方回复后发送&nbsp;&nbsp;&nbsp;
                </template>

                <el-upload
                    action="https://www.zhipin.com/wapi/zpupload/image/uploadSingle"
                    :before-upload="beforeUpload"
                    :on-success="handleUploadSuccess"
                    :show-file-list="false"
                    :data="uploadData"
                    :headers='{"Zp_token": Tools.getCookieValue("bst")}'>
                    <el-button size="small" type="primary">选择图片简历</el-button>
                </el-upload>
                <el-tag v-if="userStore.user.preference.cI" type="success" size="small" style="margin-left: 5px;">已上传</el-tag>
                <div style="font-size: 12px; color: #909399; margin-top: 4px; width: 100%;">
                    首次沟通只发送招呼语；BOSS 放开发简历能力后再发送，避免无效调用。
                </div>
            </el-form-item>

            <div style="display: flex;margin-bottom: 10px;">
                <el-checkbox v-model="userStore.user.preference.fhE" label="" size="large">过滤猎头</el-checkbox>
                <el-checkbox v-model="userStore.user.preference.polE" label="" size="large">仅投递boss在线岗位
                </el-checkbox>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                <p class="time-interval">投递间隔</p>
                <el-input-number v-model="userStore.user.preference.pi"
                                 :min="SAFE_MIN_PUSH_INTERVAL_SECONDS" :max="600"
                                  size="small"></el-input-number>
                <p class="time-interval">秒</p>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                <p class="time-interval">翻页间隔</p>
                <el-input-number v-model="userStore.user.preference.npi"
                                 :min="SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS" :max="900"
                                  size="small"></el-input-number>
                <p class="time-interval">秒</p>
            </div>

            <el-alert
                class="safety-interval-tip"
                :title="`安全节流已启用：投递间隔最低 ${SAFE_MIN_PUSH_INTERVAL_SECONDS} 秒，翻页间隔最低 ${SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS} 秒`"
                description="当前设置会在运行页同步展示，便于开始前核对。"
                type="info"
                :closable="false"
                show-icon
            />

            <el-text class="mx-1 top-title" type="warning">交互设置</el-text>

            <el-form-item label="预测问题" prop="jobContentExclude" style="margin-top: 10px;">
                <template #label>
                    <el-checkbox v-model="userStore.user.preference.ppE" label="" size="large"/>
                    预设问题&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </template>
                <el-input type="textarea" v-model="userStore.user.preference.pp"/>
            </el-form-item>

            <el-form-item label="拒绝挽留" prop="jobContentExclude">
                <template #label>
                    <el-checkbox v-model="userStore.user.preference.rfE" label="" size="large"/>
                    拒绝挽留&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </template>
                <el-input type="textarea" v-model="userStore.user.preference.rf"/>
            </el-form-item>

            <div style="display: flex;">
                <el-checkbox style="padding-top: 6px" v-model="userStore.user.preference.hiaE" label="" size="large">高意向停止AI坐席
                </el-checkbox>
                <el-text type="primary" style="margin-top: -20px;">&nbsp;&nbsp;高意向条件:</el-text>
                <el-form-item label="对话聊天轮数" prop="crC" style="margin-left:-30px;">
                    <template #label>
                        <el-text class="mx-1" type="primary" style="margin-top: 5px;">对话轮数 >=</el-text>
                    </template>
                    <el-text class="mx-1" type="primary" style="margin-top: 5px;">
                        <el-input type="number" style="width: 50px" size="small"
                                  v-model="userStore.user.preference.crC"/>
                    </el-text>

                    <el-form-item label="对话聊天轮数关键字" prop="crC" style="margin-left: 0;margin-top: 3px;">
                        <template #label>
                            <el-text class="mx-1" type="primary">OR&nbsp;&nbsp;&nbsp;包含关键字</el-text>
                        </template>
                        <el-select v-model="userStore.user.preference.crK"
                                   multiple
                                   filterable
                                   remote
                                   allow-create
                                   default-first-option
                                   :reserve-keyword="false"
                                   placeholder="包含关键字"
                                   style="min-width:200px;width: 100%">
                            <el-option v-for="(item,inx) in ['请输入包含关键字']"
                                       :key="inx"
                                       :label="item"
                                       :value="item"/>
                        </el-select>
                    </el-form-item>
                </el-form-item>
            </div>

            <el-form-item>

                <el-checkbox v-model="userStore.user.preference.drE" label="" size="large">AI坐席延迟回复
                </el-checkbox>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                <el-input-number v-model="userStore.user.preference.dr" :min="0" :max="30"  size="small"></el-input-number>
                &nbsp;秒
            </el-form-item>

            <el-text class="mx-1 top-title" type="warning">邮件通知</el-text>
            <div style="display: flex;margin-top: 10px">
                <el-checkbox v-model="userStore.user.preference.ermE" label="" size="large">每轮交流邮件通知
                </el-checkbox>
                <el-checkbox v-model="userStore.user.preference.crE" label="" size="large">
                    <el-text class="mx-1" type="danger">高意向邮件通知</el-text>
                </el-checkbox>
            </div>

            <el-form-item>
                <el-button type="primary" @click="submitForm(ruleFormRef)">保存偏好设置</el-button>
                <el-button @click="resetForm(ruleFormRef)">清除偏好设置</el-button>
                <el-button @click="exportSetting">导出偏好设置</el-button>
                <el-button @click="importSetting">导入偏好设置</el-button>
            </el-form-item>
        </div>
    </el-form>
</template>

<script lang="ts" setup>
import {computed, inject, reactive, ref} from 'vue'
import {FormInstance, FormRules, ElNotification, ElMessageBox} from 'element-plus';
import {ElMessage} from "../../utils/tools";
import {UserStore} from '../../stores'
import {AxiosInstance} from "axios";
import {applyPreferenceDefaults, PreferenceConfig} from "../../stores/types";
import {loginInterceptor} from "../../utils/tools";
import {Tools} from "../../platform/utils";
import {AbsPlatform} from "../../platform/platform";
import {
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from "../../platform/safetyLimits";
import {customGreetingEnabled} from "../../platform/greetingPolicy";

import {ServerStore} from "../../stores/server";
import {TampermonkeyApi} from "../../platform/utils";

const axios = inject('$axios') as AxiosInstance
const platform = inject('$platform') as AbsPlatform;
const userStore = UserStore();
const serverStore = ServerStore();
const protectedCompanyKeywords = new Set(
    Tools.HARD_BLOCKED_COMPANY_KEYWORDS.map(keyword => keyword.trim()).filter(Boolean)
)
const visibleCompanyExclusions = computed<string[]>({
    get: () => (userStore.user.preference.cne || [])
        .filter(keyword => !protectedCompanyKeywords.has(String(keyword).trim())),
    set: (keywords) => {
        const protectedKeywords = (userStore.user.preference.cne || [])
            .filter(keyword => protectedCompanyKeywords.has(String(keyword).trim()))
        userStore.user.preference.cne = Array.from(new Set([...keywords, ...protectedKeywords]))
    },
})

interface RuleForm {
    phone: string,
    email: string,
    companyIncludeEnable: boolean,
    companyInclude: string[],

    companyExcludeEnable: boolean,
    companyExclude: string[],

    jobNameIncludeEnable: boolean,
    jobNameInclude: string[],

    jobContentExcludeEnable: boolean,
    jobContentExclude: string[],

    salaryRangeEnable: boolean,
    salaryType: string,
    salaryRange: string,

    companyScaleRangeEnable: boolean,
    companyScaleRange: string,

    sendCustomizeGreetEnable: boolean,
    customizeGreet: string,
}

const ruleFormRef = ref<FormInstance>()


const validateEmail = (rule: any, value: string, callback: (error?: Error) => void) => {
    if (value === '') {
        callback(new Error('请输入邮箱'));
    } else if (!/^[\w-]+(\.[\w-]+)*@[\w-]+(\.[\w-]+)+$/.test(value)) {
        callback(new Error('请输入正确的邮箱'));
    } else {
        callback();
    }
};

const rules = reactive<FormRules<RuleForm>>({
    phone: [{required: true, message: '请输入手机号；作为偏好设置唯一键', trigger: 'blur'}],
    email: [{
        required: true,
        message: '请输入邮件地址；将通过邮件通知您投递进度',
        validator: validateEmail,
        trigger: 'blur'
    }],
})


const exportSetting = async () => {
    const preference = { ...userStore.user.preference };
    const exportData = JSON.stringify(preference, null, 2);
    try {
        await navigator.clipboard.writeText(exportData);
        ElNotification({
            title: '导出成功',
            message: '偏好设置已复制到剪贴板',
            type: 'success',
            duration: 2000
        });
    } catch (error) {
        ElNotification({
            title: '导出失败',
            message: '复制到剪贴板时出错',
            type: 'error',
            duration: 2000
        });
    }
}

const importSetting = async () => {
    ElMessageBox.prompt('请粘贴导出的偏好设置配置', '导入偏好设置', {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '在此粘贴配置内容',
    }).then(({ value }) => {
        try {
            const importedPreference = JSON.parse(value);
            userStore.user.preference = applyPreferenceDefaults({ ...importedPreference });
            ElNotification({
                title: '导入成功',
                message: '偏好设置已导入，请点击保存偏好设置以持久化保存',
                type: 'success',
                duration: 3000
            });
        } catch (error) {
            ElNotification({
                title: '导入失败',
                message: '配置格式错误，请检查后重试',
                type: 'error',
                duration: 2000
            });
        }
    }).catch(() => {});
}

const submitForm = async (formEl: FormInstance | undefined) => {
    if (!loginInterceptor()) {
        return;
    }
    if (!formEl) return
    if (!userStore.user.phone || !userStore.user.email) {
        ElMessage({
            message: "请填写手机号或邮箱",
            type: 'error',
            duration: 2000
        })
    }
    let valid = await formEl.validate((valid, fields) => {
        return valid;
    })

    if (!valid) {
        return;
    }
    if (userStore.user.preference.jobTitleMatchMode === 'required'
        && !(userStore.user.preference.jni || []).some(keyword => String(keyword || '').trim())) {
        ElMessage({
            message: '岗位名规则选择“必须匹配”时，请至少填写一个目标岗位关键词',
            type: 'error',
            duration: 3000,
        })
        return
    }
    userStore.user.preference.jniE = userStore.user.preference.jobTitleMatchMode === 'required'
    userStore.user.preference.cgE = customGreetingEnabled(userStore.user.preference.greetingDeliveryMode)
    if (userStore.user.preference.cgE && !String(userStore.user.preference.cg || '').trim()) {
        ElMessage({
            message: '选择自定义招呼语模式时，请先填写招呼语内容',
            type: 'error',
            duration: 3000,
        })
        return
    }

    // 无论是否在线，都先更新本地镜像和全局最新镜像
    const mirrorKey = serverStore.getMirrorKey('user_config')
    const globalMirrorKey = serverStore.getGlobalMirrorKey('user_config')
    TampermonkeyApi.GmSetValue(mirrorKey, userStore.user)
    TampermonkeyApi.GmSetValue(globalMirrorKey, userStore.user)

    await axios.post("/api/user/save/preference", {
        ...userStore.user,
        aiSeatStatus: userStore.user.aiSeatStatus ? 1 : 0
    })
        .then(resp => {
            ElMessage({
                message: "偏好设置已同步到服务器",
                type: 'success',
                duration: 2000
            })
        })
        .catch(err => {
            ElNotification({
                title: '保存至本地',
                message: '由于服务器离线，配置仅在本地生效。连接恢复后请重新同步。',
                type: 'warning',
                duration: 4000
            });
        })
}

const resetForm = (formEl: FormInstance | undefined) => {
    if (!formEl) return
    userStore.user.email = "";
    userStore.user.preference = {} as PreferenceConfig;
}

// 图片简历功能
const firstFile = ref<File | null>(null);
let jobDetail: any = platform.getFistJobDetail()
const uploadData = {
    securityId: jobDetail?.securityId,
    // securityId: BossOption.bossUserInfoMap?.values()?.next()?.value.securityId,
    source: 'chat_file',
};
const beforeUpload = (file: File) => {
    firstFile.value = file;
    return true;
};

const handleUploadSuccess = async (response: any) => {
    userStore.user.preference.cI = response.zpData.url + "===" + response.zpData.tinyUrl;
    ElMessage({
        message: "图片简历上传成功；点击下方保存偏好设置可持久保存",
        type: 'success',
        duration: 3000
    })
};

const isGenerating = ref(false);

function debounceImmediate(func: Function, wait: number) {
    let timeout: number | null = null;
    return (...args: any[]) => {
        if (!timeout) {
            func(...args);
        }
        if (timeout !== null) {
            clearTimeout(timeout);
            ElNotification({
                message: '请勿频繁点击，请等待',
                type: 'warning',
                duration: 1000
            });
        }
        timeout = window.setTimeout(() => {
            timeout = null;
        }, wait);
    };
}

const generateGreet = debounceImmediate(async () => {
    if (isGenerating.value) return;
    isGenerating.value = true;

    try {
        const response = await axios.post('/api/job/ai/assistant/generate/greeting', {}, {timeout: 16000});
        userStore.user.preference.cg = response.data.data;
        ElNotification({
            message: '招呼语生成成功，请点击下方保存偏好设置',
            type: 'success',
            duration: 2000
        });
    } catch (error) {
        ElNotification({
            title: 'AI问候语生成失败',
            message: error as string,
            type: 'error',
            duration: 3000
        });
    } finally {
        isGenerating.value = false;
    }
}, 15000);


/**
 * 偏好设置默认值处理
 */
const preferenceDefaultValueHandler = () => {
    userStore.user.preference = applyPreferenceDefaults(userStore.user.preference)
}

preferenceDefaultValueHandler()

</script>

<style scoped>

.input-opt > :first-child {
    width: 100px;
}

.form-item-upload > :first-child {
    margin-left: 0;
}

.el-input-number--small {
    line-height: 22px;
    width: 80px;
}

.time-interval{
    margin-top: 10px;
    margin-right: 1px;
    margin-left: 1px;
}

.safety-interval-tip {
    margin: -2px 0 18px;
    max-width: 860px;
}

.benefit-preference-row {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0 24px;
    margin: 6px 0 10px;
}

.benefit-preference-tip {
    line-height: 40px;
}

.commute-preference-row {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0 24px;
    margin-bottom: 10px;
}

.commute-preference-tip {
    width: 100%;
    margin: -12px 0 8px 96px;
}

.resume-match-row {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 0 24px;
    margin: 6px 0 10px;
}

.resume-match-tip {
    width: 100%;
    margin: -12px 0 8px 96px;
}


</style>
