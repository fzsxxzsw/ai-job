<template>
    <!-- 服务器配置面板 -->
    <el-card class="server-config-card" shadow="hover">
        <div class="server-config-container">
            <div class="server-status">
                <el-badge :value="serverStore.isOnline ? '在线' : '离线'" :type="serverStore.isOnline ? 'success' : 'danger'">
                    <el-text size="large" strong>服务器状态</el-text>
                </el-badge>
            </div>
            <div class="server-input">
                <el-input v-model="tempServerUrl" placeholder="请输入服务器地址" class="custom-server-input">
                    <template #prepend>服务器地址</template>
                    <template #append>
                        <el-button-group class="btn-group">
                            <el-button @click="handleUpdateServer" class="test-btn">连接测试</el-button>
                            <el-tooltip content="重置为默认地址" placement="top">
                                <el-button @click="handleResetServer" class="reset-btn">
                                    <el-icon><RefreshRight /></el-icon>
                                </el-button>
                            </el-tooltip>
                        </el-button-group>
                    </template>
                </el-input>
            </div>
            <div class="server-mode-tip">
                <el-tag :type="serverStore.isOnline ? 'success' : 'warning'" effect="dark">
                    {{ serverStore.isOnline ? '服务器已连接' : '服务器离线：无法同步偏好' }}
                </el-tag>
            </div>
        </div>
    </el-card>

    <el-card class="operation-status-card" shadow="never">
        <template #header>
            <div class="status-card-header">
                <span>投递与消息状态</span>
                <el-tag :type="pushStatus === PushStatus.PUSHING ? 'success' : pushStatus === PushStatus.PAUSE ? 'warning' : 'info'">
                    {{ pushStatusLabel }}
                </el-tag>
            </div>
        </template>

        <div class="operation-status-grid">
            <div class="status-metric">
                <span class="status-metric-label">今日已发起沟通</span>
                <strong>{{ todayPushSuccessCount }}</strong>
                <small>无本地数量上限；平台明确阻拦时停止</small>
            </div>
            <div class="status-metric">
                <span class="status-metric-label">今日投递失败</span>
                <strong class="metric-danger">{{ todayPushFailCount }}</strong>
                <small>仅统计已返回失败的请求</small>
            </div>
            <div class="status-metric">
                <span class="status-metric-label">当前安全间隔</span>
                <strong>{{ effectivePushInterval }} 秒</strong>
                <small>翻页 {{ effectiveNextPageInterval }} 秒</small>
            </div>
            <div class="status-metric status-metric-control">
                <span class="status-metric-label">停止条件</span>
                <strong>手动停止 / 平台阻拦</strong>
                <small>持续处理，不设本地数量上限</small>
            </div>
        </div>

        <div class="health-tags">
            <el-tag :type="greetingModeType" effect="plain">
                {{ greetingModeLabel }}
            </el-tag>
            <el-tag :type="aiReplyHealthType" effect="plain">
                {{ aiReplyHealthLabel }}
            </el-tag>
            <el-tag :type="aiSeatChannelReady ? 'success' : 'warning'" effect="plain">
                消息通道{{ aiSeatChannelReady ? '已连接' : '未连接' }}
            </el-tag>
            <el-tag :type="pendingSendCount > 0 ? 'warning' : 'success'" effect="plain">
                待发送/重试 {{ pendingSendCount }}
            </el-tag>
            <el-tag :type="awaitingReceiptCount > 0 ? 'warning' : 'success'" effect="plain">
                待页面送达回执 {{ awaitingReceiptCount }}
            </el-tag>
            <el-tag v-if="failedDeliveryCount > 0" type="danger" effect="plain">
                近 14 天发送失败 {{ failedDeliveryCount }}
            </el-tag>
            <el-tag v-if="blockedDeliveryCount > 0" type="danger" effect="plain">
                近 14 天已拦截 {{ blockedDeliveryCount }}
            </el-tag>
            <el-tag type="success" effect="plain">近 14 天招呼已送达/已读 {{ greetingReceiptCount }}</el-tag>
            <el-tag type="success" effect="plain">近 14 天 AI 回复已送达/已读 {{ aiReplyReceiptCount }}</el-tag>
            <el-tag v-if="ungreetedConversationCount > 0" type="danger" effect="plain">
                会话仅创建未发招呼 {{ ungreetedConversationCount }}
            </el-tag>
            <el-tag type="info" effect="plain">脚本 {{ runtimeScriptVersion }}</el-tag>
        </div>

        <div v-if="riskStopReason" class="runtime-alert risk-stop-panel">
            <el-alert title="BOSS 风控熔断已生效，投递与自动发送已停止"
                      :description="riskStopReason"
                      type="error" :closable="false" show-icon/>
            <div class="risk-stop-actions">
                <span>请先关闭 AI 回复并停止投递；确认 BOSS 官方页面已恢复后再解除。</span>
                <el-button type="warning" plain size="small" @click="handleClearRiskStop">
                    确认已恢复，解除熔断
                </el-button>
            </div>
        </div>
        <el-alert v-else-if="dailyLimitReason"
                  class="runtime-alert"
                  title="今日新增沟通已暂停"
                  :description="dailyLimitReason"
                  type="warning" :closable="false" show-icon/>
        <el-alert v-else-if="pendingSendCount > 0"
                  class="runtime-alert"
                  :title="`发送队列正在处理 ${pendingSendCount} 条消息`"
                  :description="pendingQueueDescription"
                  type="info" :closable="false" show-icon/>
    </el-card>

    <div class="action-toolbar">
        <el-tooltip effect="dark" content="从 BOSS 附件简历更新本地岗位匹配所需的信息" placement="bottom">
            <el-button :icon="Upload as any" type="primary" @click="handlerImport"
                       :disabled="!serverStore.isOnline" :loading="importResumeLoading">
                导入简历
            </el-button>
        </el-tooltip>

        <el-tooltip effect="dark" content="按当前偏好处理已筛选的岗位；每次都需要手动启动" placement="bottom">
            <el-button :icon="Promotion as any" :type="pushBtnType" @click="handlerPush">
                {{ pushBtnText }}
            </el-button>
        </el-tooltip>

        <el-button type="warning" :icon="Collection as any" color="#626aef"
                   @click.stop="handlerAISeatClick" :disabled="!serverStore.isOnline">产品列表</el-button>
        <el-tooltip effect="dark" content="服务器在线且消息通道连接时，AI 会处理招聘方发来的消息" placement="bottom">
            <el-button :icon="Service as any" color="#626aef" :disabled="!serverStore.isOnline">
                <span>AI 回复</span>
                <el-switch active-text="开" inactive-text="关" inline-prompt
                           style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                           v-model="userStore.user.aiSeatStatus"
                           :disabled="!serverStore.isOnline"
                           @change="handlerAISeatStatusChange"/>
            </el-button>
        </el-tooltip>
        <span v-if="!isProdEnv()" class="mock-control">
            MOCK 投递 <el-switch v-model="mockPush"/>
        </span>
    </div>

    <!-- 固定位置的停止投递按钮 -->
    <div v-show="pushStatus === PushStatus.PUSHING" class="fixed-stop-button">
        <!-- 实时投递运行记录显示 -->
        <div class="push-records-container">
            <div class="push-records-header">
                <span>实时投递记录</span>
            </div>
            <div class="push-records-content">
                <div v-for="(record, index) in latestPushRecords" :key="index" class="push-record-item">
                    <span class="record-time">{{ record.timestamp }}</span>
                    <span class="record-message" :class="getRecordLevelClass(record.level)">
                        {{ record.message }}
                    </span>
                </div>
                <div v-if="latestPushRecords.length === 0" class="no-records">
                    暂无投递记录
                </div>
            </div>
        </div>

        <el-button type="warning" size="large" @click="handlerFixedStopPush">
            <el-icon><CircleCloseFilled /></el-icon>
            停止投递
        </el-button>
    </div>

    <el-dialog v-model="aiSeatBuyVisible" :show-close="false" width="800">
        <template #header="{ close, titleId, titleClass }">
            <div class="my-header">
                <el-text size="large" style="font-size: 20px" type="info">产品列表</el-text>
                <el-button type="warning" @click="close">
                    <el-icon class="el-icon--left">
                        <CircleCloseFilled/>
                    </el-icon>
                    关闭
                </el-button>
            </div>

            <!--已购买产品-->
            <div v-show="buyProductList.length>0">
                <br>
                <h3>我的产品列表</h3>
                <br>
                <el-table v-show="buyProductList.length>0" :data="buyProductList" stripe style="width: 100%">
                    <el-table-column prop="productName" label="产品" width="180">
                        <template v-slot="{ row }">
                            <span :style="{ textDecoration: isExpired(row) ? 'line-through' : 'none' }">
                                {{ row.productName }}
                            </span>
                        </template>
                    </el-table-column>

                    <!-- 状态列 -->
                    <el-table-column label="状态" width="100">
                        <template v-slot="{ row }">
                            <span :style="{ color: isExpired(row) ? 'red' : 'green' }">
                                {{ isExpired(row) ? '过期' : '正常' }}
                            </span>
                        </template>
                    </el-table-column>

                    <el-table-column prop="powerList" label="能力" width="180">
                        <template v-slot="{ row }">
                            <div v-for="power in row.powerList" :key="power">
                                <el-tag effect="dark" :type="randomStyle()" size="small">{{ power }}</el-tag>
                            </div>
                        </template>
                    </el-table-column>
                    <el-table-column prop="periodOfValidityStartTime" label="有效期开始时间"/>
                    <el-table-column prop="periodOfValidityEndTime" label="有效期结束时间"/>
                </el-table>
                <br>
            </div>

            <!--            搜索展示不做条件限制-->
            <!--            <div v-show="!showOtherProduct" type="info">-->
            <div  type="info" style="margin-top: 10px">
                <el-button type="danger" :icon="Shop" @click="showOrderGroup">
                    更多产品
                </el-button>
                <el-input :suffix-icon="Wallet" v-model="promotionCode" style="margin-left: 10px;width: 240px" placeholder="请输入优惠码" />
                <el-link :icon="PriceTag" type="primary" style="margin-left: 30px;" target="_blank" href="https://www.bilibili.com/video/BV1HKAyebESp">点击获取优惠码(评论区)</el-link>

            </div>

            <el-empty v-show="!buyProductList?.length && !showOtherProduct" :image-size="50" description="购买产品为空，请点击更多产品查看"/>

            <!--订单组二维码-->
            <div v-if="showOtherProduct" v-loading="productListLoading">
                <br>
                <p>
                    <el-text class="mx-1" type="danger">定价说明：</el-text>
                    使用R1深度思考大模型时：首先，R1的价格更贵，深度思考的内容也会被记录token消耗。token消耗量巨大。同时由于boss的会话聊天机制，需要携带消息上下文调用。这也就意味着对话轮数越多，token消耗越多。按乘方的趋势增长。
                </p>
                <br>
                <div v-for="order in orderGroup" :key="order" style="display: flex" class="block"
                     :style="'width: '+1/orderGroup.length">
                    <!--订单标题-->
                    <div style="padding-top: 10px;min-width: 8%;">
                        <p class="demonstration">
                            <el-text size="large" type="primary">{{ order.title }}</el-text>
                        </p>
                        <p class="demonstration">
                            <el-text size="large" type="success">{{ order.validDays }}天</el-text>
                        </p>
                        <p class="demonstration">
                            <el-text size="large" type="danger">￥ {{ order.totalAmount }}</el-text>
                        </p>
                    </div>

                    <!--图片二维码-->
                    <el-image style="width: 100px; height: 100px" :src="'data:image/png;base64,'+order.qrCodeBase64"
                              fit="fill">
                        <template #error>
                            <div class="image-slot">加载订单二维码失败；请稍后刷新重试</div>
                        </template>
                    </el-image>

                    <div style="width: 80%">
                        <!--产品能力标签-->
                        <div>
                            提供能力:
                            <el-tag style="margin: 10px;" v-for="tag in order.tags" :key="tag" :type="randomStyle()"
                                    size="large" effect="light">{{ tag }}
                            </el-tag>
                        </div>
                        <!--产品推广描述-->
                        <div>
                            <span class="demonstration">{{ order.desc }}</span>
                        </div>
                    </div>
                </div>
            </div>

        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import axiosOriginal, {AxiosInstance} from "axios";
import {CircleCloseFilled, PriceTag, Promotion, Service, Shop, Upload, Wallet, Collection, RefreshRight} from '../icons';
import {computed, h, inject, ref, Ref, onMounted, onUnmounted} from "vue";
import {PushStatus} from "../../enums";
import {AbsPlatform} from "../../platform/platform";
import {TampermonkeyApi, Tools} from "../../platform/utils";
import {ElMessage, fetchWithGM_request, isProdEnv, loginInterceptor, silentlyLogin} from "../../utils/tools";
import logger from '../../logging'
import {SSEClient} from "../../utils/sse";
import {LoginStore, pushResultCount, UserStore} from "../../stores";
import {DEFAULT_SERVER_URL, ServerStore} from "../../stores/server";
import {ElMessageBox, ElNotification} from "element-plus";
import {LogRecorder} from "../../logging/record";
import {GM_getValue, GM_info} from "$";
import {readDeliveryAudit} from "../../platform/deliveryAudit";
import {countBlockingDeliveries, type RetryQueueEntry} from "../../platform/deliveryQueue";
import {clearBossRiskCircuit, getBossRiskStop} from "../../platform/bossRiskControl";
import {isLegacyLocalDailyLimit, makeBossDailyLimitKey} from "../../platform/bossDailyLimit";
import {
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
} from "../../platform/safetyLimits";
import {
    customGreetingEnabled,
    greetingRequiresReadyChannel,
    normalizeGreetingDeliveryMode,
} from "../../platform/greetingPolicy";

import {userRemoteLoad} from "../../stores/remote";
import {PushRunStore} from "../../stores/pushRun";

const platform = inject('$platform') as AbsPlatform;
const axios = inject('$axios') as AxiosInstance
const serverStore = ServerStore();
const tempServerUrl = ref(serverStore.baseUrl);

const handleUpdateServer = async () => {
    try {
        serverStore.setBaseUrl(tempServerUrl.value);
        tempServerUrl.value = serverStore.baseUrl;
    } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : '服务器地址格式不正确');
        return;
    }
    await serverStore.checkConnection();
    if (serverStore.isOnline) {
        // 连接成功后，立即尝试加载/同步配置
        userRemoteLoad(true);

        const countdown = ref(3);
        let timer: any = null;

        const notifyInstance = ElNotification({
            title: '连接成功',
            type: 'success',
            duration: 0, // 不自动关闭
            message: h(() => h('div', null, [
                h('p', null, '已成功连接到服务器，正在同步配置...'),
                h('p', {style: 'color: #E6A23C; margin-top: 5px; font-weight: bold;'}, `页面将在 ${countdown.value} 秒后自动刷新以同步登录状态`),
                h('div', {style: 'margin-top: 10px; text-align: right;'}, [
                    h('button', {
                        class: 'el-button el-button--small el-button--warning',
                        onClick: () => {
                            if (timer) {
                                clearInterval(timer);
                                timer = null;
                                notifyInstance.close();
                                ElMessage.info('已取消自动刷新，请手动刷新以同步登录');
                            }
                        }
                    }, '取消刷新')
                ])
            ])) as any
        });

        timer = setInterval(() => {
            countdown.value--;
            if (countdown.value <= 0) {
                clearInterval(timer);
                window.location.reload();
            }
        }, 1000);
    } else {
        ElNotification({
            title: '连接失败',
            message: serverStore.lastError || '无法访问服务器',
            type: 'error',
            duration: 3000
        });
    }
};

const handleResetServer = async () => {
    if (typeof serverStore.resetBaseUrl === 'function') {
        serverStore.resetBaseUrl();
        tempServerUrl.value = serverStore.baseUrl;
        ElMessage.success('已重置为默认服务器地址');
        await handleUpdateServer();
    } else {
        // 容错处理
        serverStore.setBaseUrl(DEFAULT_SERVER_URL);
        tempServerUrl.value = DEFAULT_SERVER_URL;
        ElMessage.success('已重置为默认服务器地址');
        await handleUpdateServer();
    }
};

const pushRunStore = PushRunStore()
const pushStatus = computed(() => pushRunStore.isActive ? PushStatus.PUSHING
    : pushRunStore.status === 'idle' ? PushStatus.NOT_START : PushStatus.PAUSE)
const pushBtnType = computed<'primary' | 'warning'>(() => pushRunStore.isActive ? 'warning' : 'primary')
const pushBtnText = computed(() => pushRunStore.isActive ? '停止投递' : '开始投递')
const aiSeatBuyVisible = ref(false)
const importResumeLoading = ref<boolean>(false);
const productListLoading = ref<boolean>(false);
const aiSeatChannelReady = ref(false)
const pendingGreetingCount = ref(0)
const pendingAiReplyCount = ref(0)
const pendingSendCount = ref(0)
const awaitingReceiptCount = ref(0)
const failedDeliveryCount = ref(0)
const blockedDeliveryCount = ref(0)
const ungreetedConversationCount = ref(0)
const greetingReceiptCount = ref(0)
const aiReplyReceiptCount = ref(0)
const todayPushSuccessCount = ref(0)
const todayPushFailCount = ref(0)
const riskStopReason = ref('')
const dailyLimitReason = ref('')
const runtimeStatus = Tools.window.__AI_JOB_HELPER_RUNTIME_STATUS__
const runtimeScriptVersion = [
    runtimeStatus?.version || GM_info?.script?.version || '未知版本',
    runtimeStatus?.buildId ? `build ${runtimeStatus.buildId}` : '',
].filter(Boolean).join(' · ')

// 创建日志记录器实例
const logRecorder = new LogRecorder();
const latestPushRecords = ref<{ level: string; message: string; timestamp: string }[]>([]);
let recordsUpdateTimer: ReturnType<typeof setInterval> | null = null;

// 已经购买产品
const buyProductList = ref([])

// 显示其他产品
const showOtherProduct = ref(true)
const orderGroup: Ref = ref([])
const payStatus = ref(false)
const promotionCode = ref('')
const lastPromotionCode = ref('')

let loginStore = LoginStore();
let pushResultCounter = pushResultCount();

const userStore = UserStore();
const effectivePushInterval = computed(() => Math.max(
    SAFE_MIN_PUSH_INTERVAL_SECONDS,
    Number(userStore.user.preference?.pi) || SAFE_MIN_PUSH_INTERVAL_SECONDS,
))
const effectiveNextPageInterval = computed(() => Math.max(
    SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
    Number(userStore.user.preference?.npi) || SAFE_MIN_NEXT_PAGE_INTERVAL_SECONDS,
))
const greetingMode = computed(() => normalizeGreetingDeliveryMode(
    userStore.user.preference?.greetingDeliveryMode,
    !!userStore.user.preference?.cgE,
    userStore.user.preference?.cg,
))
const greetingModeLabel = computed(() => ({
    'platform-default': '纯规则投递：平台默认招呼',
    'custom-queued': '自定义招呼：后台补发',
    'custom-required': '自定义招呼：严格确认',
}[greetingMode.value]))
const greetingModeType = computed<'success' | 'warning' | 'info'>(() =>
    greetingMode.value === 'platform-default' ? 'success'
        : greetingMode.value === 'custom-required' ? 'warning' : 'info')
const pendingQueueDescription = computed(() => greetingMode.value === 'custom-required'
    ? '严格模式会等待自定义招呼语取得 BOSS 服务器确认；无需重复点击。'
    : '消息队列在后台独立补发，不阻塞纯规则岗位投递。')
const pushStatusLabel = computed(() => {
    if (pushRunStore.status === 'preparing') return '正在执行启动预检'
    if (pushRunStore.status === 'running') return '投递进行中'
    if (pushRunStore.status === 'stopping') return '正在停止'
    if (pushRunStore.status === 'completed') return '本轮已完成'
    if (pushRunStore.status === 'blocked') return `已阻止：${pushRunStore.reason || '前置条件不满足'}`
    if (pushRunStore.status === 'failed') return '运行异常'
    if (pushRunStore.status === 'stopped') return '已停止'
    return '等待手动启动'
})
const aiReplyHealthType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
    if (!userStore.user.aiSeatStatus) return 'info'
    if (!serverStore.isOnline) return 'danger'
    return aiSeatChannelReady.value ? 'success' : 'warning'
})
const aiReplyHealthLabel = computed(() => {
    if (!userStore.user.aiSeatStatus) return 'AI 回复未启用'
    if (!serverStore.isOnline) return 'AI 回复不可用：服务器离线'
    return aiSeatChannelReady.value ? 'AI 回复通道已就绪' : 'AI 回复等待消息通道'
})
// --------------------------------------------------函数定义-------------------------------------------------------------

// 获取最新的投递记录
const updateLatestPushRecords = () => {
    const allLogs = logRecorder.getLogs(1, logRecorder.getLogCount());
    // 筛选投递相关的日志（包含"投递"、"push"等关键词）
    const pushLogs = allLogs.filter(log =>
        log.message.toLowerCase().includes('投递') ||
        log.message.toLowerCase().includes('下一页') ||
        log.message.toLowerCase().includes('工作')
    );
    // 获取最新的5条记录，最新数据在下方
    latestPushRecords.value = pushLogs.slice(-10);
};

// 获取记录级别的样式类
const getRecordLevelClass = (level: string): string => {
    switch (level.toLowerCase()) {
        case 'error':
            return 'record-error';
        case 'warn':
            return 'record-warn';
        case 'info':
            return 'record-info';
        case 'debug':
            return 'record-debug';
        case 'trace':
            return 'record-trace';
        default:
            return 'record-info';
    }
};

// 开始定时更新记录
const startRecordsUpdate = () => {
    if (recordsUpdateTimer) {
        clearInterval(recordsUpdateTimer);
    }
    updateLatestPushRecords();
    // 每200ms更新一次
    recordsUpdateTimer = setInterval(updateLatestPushRecords, 500);
};

// 停止定时更新记录
const stopRecordsUpdate = () => {
    if (recordsUpdateTimer) {
        clearInterval(recordsUpdateTimer);
        recordsUpdateTimer = null;
    }
};

const isExpired = (row: any): boolean => {
    const currentTime = new Date();
    const endTime = new Date(row.periodOfValidityEndTime);
    return currentTime > endTime;
}


const randomStyle = (): string => {
    const tagStyleArr = ['primary', 'warning', 'success', 'danger']
    let number = Math.floor(Math.random() * 4);
    return tagStyleArr[number];
}

// 滚动到页面顶部
const scrollToTop = () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// --------------------------------------------------函数定义-------------------------------------------------------------


// --------------------------------------------------事件处理-------------------------------------------------------------
const handlerImport = async () => {

    if (!loginInterceptor()) {
        return;
    }
    const token = Tools.window?._PAGE?.token;
    let bossUserId = Tools.window?._PAGE?.uid
    if (!bossUserId) {
        ElMessage({
            message: "未获取到Boss userId 请刷新页面重试",
            type: 'error',
            duration: 3000
        })
        return;
    }

    importResumeLoading.value = true;
    // 获取简历id
    let resumeInfoResp = await axiosOriginal.get("https://www.zhipin.com/wapi/zpgeek/resume/sidebar.json", {headers: {"Zp_token": token}} as {})
    let zpData = resumeInfoResp.data.zpData;
    if (!zpData.attachmentList || zpData.attachmentList.length == 0) {
        importResumeLoading.value = false;
        ElMessage({
            message: "请先在 BOSS 个人中心上传附件简历，作为 AI 回复的简历依据",
            type: 'error',
            duration: 3000
        })
        return;
    }
    let resumeId = zpData.attachmentList[0].resumeId

    // 获取简历文件
    let resumeFileResp: any = await fetchWithGM_request("https://docdownload.zhipin.com/wflow/zpgeek/download/download4geek?resumeId=" + resumeId,
        {headers: {"Zp_token": token}, responseType: 'arraybuffer'} as {})
    let fileBlob = new Blob([resumeFileResp.response], {type: 'application/pdf'});

    // 导入简历
    let formData = new FormData();
    formData.append("file", fileBlob)
    formData.append("resumeId", resumeId)
    formData.append("uniqueId", bossUserId)
    let importResp = await axios.post("/api/user/import/resume", formData, {headers: {'Content-Type': "multipart/form-data"}})
    if (importResp.data.code != 200) {
        ElMessage({
            message: "导入简历失败" + importResp.data.data.msg,
            type: 'error',
            duration: 3000
        })
        importResumeLoading.value = false;
        return;
    }
    let loginResp = await axios.post("/api/user/silently/login?uniqueId=" + bossUserId)
    localStorage.setItem('Authorization', loginResp.data.data);
    if(!importResp.data.data.email){
        ElMessage({
            message: "导入简历成功；但未识别到邮箱，请在偏好设置中完善[通知邮箱]",
            type: 'warning',
            duration: 3000
        })
        importResumeLoading.value = false;
        return;
    }
    ElMessage({
        message: "导入简历成功",
        type: 'success',
        duration: 3000
    });
    importResumeLoading.value = false;
}
const handlerPush = () => {
    switch (pushStatus.value) {
        case PushStatus.NOT_START:
            startPush();
            break;
        case PushStatus.PUSHING:
            pausePush();
            break;
        case PushStatus.PAUSE:
            startPush()
            break;
    }
}

// 固定按钮停止投递处理
const handlerFixedStopPush = () => {
    pausePush();
    scrollToTop();
}

const AUTO_START_PUSH_KEY = 'ai-job-hunting-auto-start-push'
// 安全迁移：旧版本可能把自动真投保存在 localStorage。新版本永久清除该状态，
// 进入职位页只能由用户手动点击开始，刷新页面也不会自动恢复投递。
localStorage.setItem(AUTO_START_PUSH_KEY, 'false')

// 非生产环境支持mock投递
const mockPush = ref<boolean>(false)

const executePushRun = async () => {
    if (!loginInterceptor()) {
        return {status: 'blocked', reason: 'BOSS 或本地服务尚未登录'} as const
    }
    try {
        // Login becoming ready is not proof that the preference request has completed.
        // Always await the authoritative server config before the first BOSS side effect,
        // otherwise cgE/cg can still be empty and create a bare “正在沟通” session.
        await userRemoteLoad(true)
    } catch (error: any) {
        logRecorder.error('用户偏好尚未加载，已阻止开始投递', error?.message || error)
        ElMessage({
            type: 'error',
            message: '用户偏好尚未加载，未开始投递',
        })
        return {status: 'blocked', reason: '用户偏好尚未加载'} as const
    }

    if (!serverStore.isOnline) {
        logRecorder.error('后端服务器离线，未开始投递')
        ElMessage({
            type: 'error',
            message: '后端服务器离线，请先连接服务器并确认配置加载成功',
        })
        return {status: 'blocked', reason: '后端服务器离线'} as const
    }

    const configuredGreeting = userStore.user.preference?.cg?.trim() || ''
    const configuredGreetingMode = normalizeGreetingDeliveryMode(
        userStore.user.preference?.greetingDeliveryMode,
        !!userStore.user.preference?.cgE,
        configuredGreeting,
    )
    userStore.user.preference.greetingDeliveryMode = configuredGreetingMode
    userStore.user.preference.cgE = customGreetingEnabled(configuredGreetingMode)
    if (customGreetingEnabled(configuredGreetingMode) && !configuredGreeting) {
        logRecorder.error('已选择自定义招呼语模式，但招呼语内容为空')
        ElMessage({
            type: 'error',
            message: '自定义招呼语内容为空，未开始投递',
        })
        return {status: 'blocked', reason: '自定义招呼语未配置'} as const
    }

    const riskStop = getBossRiskStop()
    if (riskStop) {
        logRecorder.error(`BOSS 风控熔断已生效，未开始投递：${riskStop.reason}`)
        ElMessage({
            type: 'error',
            message: `BOSS 已阻拦，未开始投递：${riskStop.reason}`,
        })
        return {status: 'blocked', reason: riskStop.reason} as const
    }

    if (greetingRequiresReadyChannel(configuredGreetingMode)
        && !Tools.window.AIJobHelperChatBridge?.isReady?.()) {
        ElMessage({
            type: 'info',
            message: '正在连接 BOSS 消息服务，请稍候…',
            duration: 2500,
        })
        let channelReady = false
        try {
            channelReady = await Promise.resolve(
                Tools.window.AIJobHelperChatBridge?.ensureReady?.(10_000),
            ) === true
        } finally {
            // ensureReady 不产生投递副作用；结束后仍需检查用户是否在预检阶段停止。
        }
        if (pushRunStore.stopRequested) {
            return {status: 'stopped', reason: '用户在消息通道预检阶段停止'} as const
        }
        if (!channelReady) {
            const channelError = Tools.window.AIJobHelperChatBridge?.getLastError?.()
                || 'BOSS 消息服务尚未完成初始化'
            logRecorder.error(`消息服务未就绪，未开始投递：${channelError}`)
            ElMessage({
                type: 'error',
                message: `消息服务未就绪，未开始投递：${channelError}`,
                duration: 6000,
            })
            return {status: 'blocked', reason: channelError} as const
        }
    } else if (configuredGreetingMode === 'custom-queued'
        && !Tools.window.AIJobHelperChatBridge?.isReady?.()) {
        const diagnostics = Tools.window.AIJobHelperChatBridge?.getDiagnostics?.()
        const reason = diagnostics?.summary || Tools.window.AIJobHelperChatBridge?.getLastError?.()
            || '通道暂未就绪'
        logRecorder.warn(`自定义招呼语将在后台补发，纯规则投递继续：${reason}`)
    } else if (configuredGreetingMode === 'platform-default') {
        logRecorder.info('使用纯规则投递与平台默认招呼，不检查 AI 或聊天通道')
    }

    if (pushRunStore.stopRequested) {
        return {status: 'stopped', reason: '用户在启动预检阶段停止'} as const
    }
    if (!pushRunStore.markRunning()) {
        return {status: 'stopped', reason: '投递启动已取消'} as const
    }

    platform.pushMock = mockPush.value

    // 开始更新投递记录
    startRecordsUpdate();

    try {
        const outcome = await platform.startPush()
        if (outcome.status === 'completed') {
            ElMessage({message: '批量投递完成', type: 'success', duration: 3000})
        } else if (outcome.status === 'blocked') {
            ElMessage({
                message: `平台已阻拦，投递已停止：${outcome.reason || '未知原因'}`,
                type: 'warning',
                duration: 5000,
            })
        }
        return outcome
    } catch (error: any) {
        logRecorder.error('投递流程异常结束', error?.message || error)
        ElMessage({
            message: `投递流程异常结束：${error?.message || '未知错误'}`,
            type: 'error',
            duration: 5000,
        })
        throw error
    } finally {
        stopRecordsUpdate()
    }
}

const startPush = async () => {
    if (pushRunStore.isActive || !loginInterceptor()) return
    try {
        const execution = await pushRunStore.run(executePushRun, () => platform.pausePush())
        if (!execution.acquired) {
            ElMessage({
                type: 'warning',
                message: '另一个 BOSS 标签页或当前页面已有投递任务正在运行',
                duration: 5000,
            })
        }
    } catch (_) {
        // executePushRun 已记录并展示具体异常；这里避免点击事件产生未处理 Promise。
    }
}

const pausePush = () => {
    pushRunStore.stop()
    platform.pausePush()
    // 停止更新投递记录
    stopRecordsUpdate();
}

const handleClearRiskStop = async () => {
    if (pushRunStore.isActive) {
        ElMessage.warning('请先点击“停止投递”，等待当前投递任务完全停止')
        return
    }
    if (userStore.user.aiSeatStatus) {
        ElMessage.warning('请先关闭“AI 回复”开关，避免解除后自动处理新消息')
        return
    }

    try {
        await ElMessageBox.confirm(
            '仅当你已在 BOSS 官方页面确认账号恢复正常时解除。解除后不会自动启动投递或 AI 回复。',
            '解除本地风控熔断',
            {
                confirmButtonText: '确认解除',
                cancelButtonText: '取消',
                type: 'warning',
            },
        )
    } catch (_) {
        return
    }

    if (!clearBossRiskCircuit()) {
        ElMessage.error('本地熔断状态清除失败，请刷新页面后重试')
        return
    }
    riskStopReason.value = ''
    logRecorder.warn('用户确认 BOSS 账号已恢复，已解除本地风控熔断；投递与 AI 回复保持停止')
    ElMessage.success('本地风控熔断已解除；请按需手动开启 AI 回复或投递')
}

const handlerAISeatClick = async () => {
    //  显示弹窗
    aiSeatBuyVisible.value = true

    if (buyProductList.value.length <= 0) {
        await queryBuyProductList()
    }

    // if (buyProductList.value.length > 0) {
    //     // 显示产品集合
    //     return;
    // }
    showOtherProduct.value = false

    // 没有产品，直接调用接口生成订单组
    // await showOrderGroup()
}

const queryBuyProductList = async () => {
    // 已购买产品集合
    let productResp = await axios.post("/api/product/user/product/list")
    buyProductList.value = productResp.data.data
}

const showOrderGroup = async () => {
    if (!loginInterceptor()) {
        return;
    }
    productListLoading.value = true
    let promotionCodeVar = promotionCode.value.trim()
    promotionCode.value = ''
    setTimeout(() => {
        showOtherProduct.value = true;
    }, 100)
    // 如果之前生成过订单，或者和上次的优惠码一致时，则不再生成订单
    if (orderGroup.value.length < 1 || promotionCodeVar !== lastPromotionCode.value) {
        // 生成订单组
        let orderGroupResp = await axios.post("/api/pay/generate/order/group", {promotionCode: promotionCodeVar});
        if (orderGroupResp.data.code != 200) {
            ElMessage({
                message: orderGroupResp.data.message,
                type: 'warning',
                duration: 3000
            })
            setTimeout(() => {
                showOtherProduct.value = false;
            }, 100)
            productListLoading.value = false
            return;
        }
        orderGroup.value = orderGroupResp.data.data
        lastPromotionCode.value = promotionCodeVar
        productListLoading.value = false
    }
    productListLoading.value = false

    waitUsePay()
}

const waitUsePay = () => {
    // 建立sse连接，用于服务端通知前端订单支付成功
    const sseClient = new SSEClient(axios.defaults.baseURL + 'api/sse/connect');
    sseClient.addOnMsgCallback((event: any) => {
        let data = event.data;
        if (data === "支付成功") {
            // 支付成功，清除之前的付款二维码
            payStatus.value = true
            orderGroup.value = []
            queryBuyProductList()
            showOtherProduct.value = false
            firstAiSeatStatus.value = 0;
        }
    })
    sseClient.start();

    // 半分钟之后主动查询订单状态
    let count = 0;
    let interval = setInterval(() => {
        if (payStatus.value) {
            // sse通知订单已经支付成功，取消轮询查询订单
            clearInterval(interval)
        }
        orderGroup.value.forEach((orderItem: any) => {
            axios.get("/api/pay/searchOrder?outTradeNo=" + orderItem.orderId).then(resp => {
                if (resp.data.data === "TRADE_SUCCESS") {
                    payStatus.value = true
                    orderGroup.value = []
                    clearInterval(interval)
                }
                if (resp.data.data === "WAIT_BUYER_PAY") {
                    logger.debug("等待支付")
                }

                count++
                if (count >= 10) {
                    logger.warn("订单超时未支付")
                    clearInterval(interval)
                }
            })
        })
    }, 30000);
}

const firstAiSeatStatus = ref(userStore.user.aiSeatStatus)
setTimeout(() => {
    firstAiSeatStatus.value = userStore.user.aiSeatStatus
    logger.info("firstAiSeatStatus", firstAiSeatStatus.value)
}, 1500)

const handlerAISeatStatusChange = async (val: boolean) => {
    if (firstAiSeatStatus.value == null) {
        return;
    }

    if (!loginInterceptor()) {
        return;
    }

    return axios.post("/api/user/save/preference", {
        aiSeatStatus: val ? 1 : 0
    }).then(resp => {
        if (val && resp.data.message && resp.data.message !== "成功") {
            ElNotification({
                message: resp.data.message,
                type: 'success',
                duration: 2000
            });
        }
    }).catch(_ => {
        userStore.user.aiSeatStatus = firstAiSeatStatus.value
    })
}
const handlerAISeatSwitchClick = async () => {
    if (firstAiSeatStatus.value == null) {
        ElMessage({
            message: "请先点击前面的AI坐席购买",
            grouping: true,
            type: 'info',
            duration: 3000
        })
    }
}


// --------------------------------------------------事件处理-------------------------------------------------------------

// --------------------------------------------------流程处理-------------------------------------------------------------

// 静默登录
if (!loginStore.login && !loginStore.loginFailStatus) {
    logger.info("页面静默登录")
    silentlyLogin("").catch(_ => {
    })
}

let aiSeatHealthTimer: number | null = null
onMounted(() => {
    // The run belongs to the Pinia store, not this component. When the user
    // switches menus and comes back, reconnect the transient log view to the
    // still-running task instead of presenting a second Start button.
    if (pushRunStore.isActive) startRecordsUpdate()
    const readDeliveryQueue = (key: string): RetryQueueEntry[] => {
        try {
            const gmQueue = GM_getValue(key, '') as string
            const queue = JSON.parse(gmQueue || localStorage.getItem(key) || '[]')
            return Array.isArray(queue) ? queue.filter(item => item?.key) : []
        } catch (_) {
            return []
        }
    }

    const refreshAiSeatHealth = () => {
        aiSeatChannelReady.value = !!Tools.window.AIJobHelperChatBridge?.isReady?.()
        const greetingQueue = readDeliveryQueue('ai-job-pending-greetings-v1')
        const aiReplyQueue = readDeliveryQueue('ai-job-pending-ai-replies-v1')
        pendingGreetingCount.value = countBlockingDeliveries(greetingQueue)
        pendingAiReplyCount.value = countBlockingDeliveries(aiReplyQueue)
        pendingSendCount.value = pendingGreetingCount.value + pendingAiReplyCount.value

        const deliveryAudit = readDeliveryAudit()
        awaitingReceiptCount.value = deliveryAudit.filter(item => item.status === 'acknowledged').length
        failedDeliveryCount.value = deliveryAudit.filter(item => item.status === 'failed').length
        blockedDeliveryCount.value = deliveryAudit.filter(item => item.status === 'blocked').length
        greetingReceiptCount.value = deliveryAudit.filter(item => item.kind === 'greeting'
            && item.status === 'receipt' && !!item.bossId && !!item.conversationKey
            && !!item.clientMid && !!item.serverMid).length
        aiReplyReceiptCount.value = deliveryAudit.filter(item => item.kind === 'ai-reply'
            && item.status === 'receipt' && !!item.bossId && !!item.conversationKey
            && !!item.clientMid && !!item.serverMid).length
        ungreetedConversationCount.value = location.pathname.includes('/web/geek/chat')
            ? Array.from(document.querySelectorAll('li')).filter(item =>
                item.textContent?.includes('您正在与Boss') && !item.textContent?.includes('[草稿]')
            ).length
            : 0

        todayPushSuccessCount.value = Number(TampermonkeyApi.GmGetValue(
            TampermonkeyApi.PUSH_SUCCESS_COUNT,
            pushResultCounter.successCount,
        )) || 0
        todayPushFailCount.value = Number(TampermonkeyApi.GmGetValue(
            TampermonkeyApi.PUSH_FAIL_COUNT,
            pushResultCounter.failCount,
        )) || 0
        riskStopReason.value = getBossRiskStop()?.reason || ''
        const storedDailyLimit = TampermonkeyApi.GmGetValue(makeBossDailyLimitKey(), false)
        if (isLegacyLocalDailyLimit(storedDailyLimit)) {
            TampermonkeyApi.GmSetValue(makeBossDailyLimitKey(), false)
        }
        const activeDailyLimit = isLegacyLocalDailyLimit(storedDailyLimit) ? false : storedDailyLimit
        dailyLimitReason.value = activeDailyLimit === true
            ? 'BOSS 已标记今日沟通达到平台上限'
            : typeof activeDailyLimit === 'string' ? activeDailyLimit : ''
    }
    refreshAiSeatHealth()
    aiSeatHealthTimer = window.setInterval(refreshAiSeatHealth, 1000)
})

// 组件卸载时清理定时器
onUnmounted(() => {
    stopRecordsUpdate();
    if (aiSeatHealthTimer !== null) {
        window.clearInterval(aiSeatHealthTimer)
    }
});

// --------------------------------------------------流程处理-------------------------------------------------------------
</script>

<style scoped>
.server-config-card {
    margin-bottom: 20px;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(10px);
    border-radius: 12px;
}

.server-config-container {
    display: grid;
    grid-template-columns: auto minmax(360px, 1fr) auto;
    align-items: center;
    gap: 16px;
}

.server-status {
    min-width: 120px;
}

.server-input {
    min-width: 0;
    width: 100%;
}

:deep(.custom-server-input .el-input-group__prepend) {
    width: 100px;
    text-align: center;
    padding: 0 10px;
}

:deep(.custom-server-input .el-input-group__append) {
    padding: 0;
    width: 140px;
}

:deep(.custom-server-input .el-input-group__append .btn-group) {
    display: flex;
    height: 100%;
    width: 100%;
}

:deep(.custom-server-input .el-input-group__append .el-button) {
    border: none;
    margin: 0;
    height: 100%;
    flex: 1;
    border-radius: 0;
    display: flex;
    justify-content: center;
    align-items: center;
}

:deep(.custom-server-input .el-input-group__append .test-btn) {
    padding: 0 10px;
    border-right: 1px solid #dcdfe6;
    flex: 2;
}

:deep(.custom-server-input .el-input-group__append .reset-btn) {
    padding: 0;
    border-radius: 0 4px 4px 0;
    flex: 1;
    min-width: 40px;
}

.server-mode-tip {
    justify-self: end;
}

@media (max-width: 900px) {
    .server-config-container {
        grid-template-columns: 1fr;
    }

    .server-mode-tip {
        justify-self: start;
    }
}

.operation-status-card {
    margin-bottom: 14px;
    border-color: #dcdfe6;
}

.status-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
}

.operation-status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
}

.status-metric {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border-radius: 8px;
    background: #f5f7fa;
}

.status-metric-label,
.status-metric small {
    color: #606266;
}

.status-metric strong {
    color: #303133;
    font-size: 22px;
    line-height: 1.2;
}

.status-metric .metric-danger {
    color: #f56c6c;
}

.status-metric-control :deep(.el-input-number) {
    width: 120px;
}

.health-tags,
.action-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.health-tags {
    margin-top: 14px;
}

.runtime-alert {
    margin-top: 12px;
}

.risk-stop-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    color: #7a4b00;
    background: #fdf6ec;
    border: 1px solid #faecd8;
    border-top: 0;
    border-radius: 0 0 4px 4px;
}

.action-toolbar {
    margin-bottom: 14px;
}

.mock-control {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #606266;
}

.my-header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    gap: 16px;
}

/* 固定位置的停止投递按钮样式 */
.fixed-stop-button {
    position: fixed;
    right: 80px;
    bottom: 80px;
    z-index: 9999;
    background: rgba(255, 255, 255, 0.95);
    padding: 8px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.3);
}

.fixed-stop-button:hover {
    background: rgba(255, 255, 255, 1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
}

/* 投递记录容器样式 */
.push-records-container {
    margin-bottom: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    overflow: hidden;
    max-width: 400px;
}

.push-records-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: 500;
    text-align: center;
}

.push-records-content {
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
}

.push-record-item {
    display: flex;
    flex-direction: column;
    margin-bottom: 8px;
    padding: 6px 8px;
    background: rgba(248, 250, 252, 0.8);
    border-radius: 4px;
    border-left: 3px solid #e2e8f0;
    font-size: 12px;
    line-height: 1.4;
}

.push-record-item:last-child {
    margin-bottom: 0;
}

.record-time {
    color: #64748b;
    font-size: 11px;
    margin-bottom: 2px;
}

.record-message {
    color: #334155;
    word-break: break-word;
}

.record-error {
    color: #dc2626;
    border-left-color: #dc2626;
}

.record-warn {
    color: #d97706;
    border-left-color: #d97706;
}

.record-info {
    color: #2563eb;
    border-left-color: #2563eb;
}

.record-debug {
    color: #059669;
    border-left-color: #059669;
}

.record-trace {
    color: #7c3aed;
    border-left-color: #7c3aed;
}

.no-records {
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
    padding: 20px 0;
}

/* 滚动条样式 */
.push-records-content::-webkit-scrollbar {
    width: 4px;
}

.push-records-content::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 2px;
}

.push-records-content::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
}

.push-records-content::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
}
</style>
