# Agent 与 Python 健壮性审计（2026-09-16）

## 结论

服务、数据库和模型连接都在运行，单元测试也较完整；用户可见的问题主要来自业务链路没有接通，而不是 AI 密钥或模型供应商不可用。

当前没有形成以下闭环：

```text
岗位发现 → APPLICATION 决策 → 经授权投递 → 结果证据
   ↑                                      ↓
下一轮筛选 / 排序 / 回复策略 ← 职业复盘 ← 结果与人工更正
```

实际运行更接近：

```text
浏览器本地规则 → 直接发起 BOSS 沟通 → 投递快照
                    （绕过 APPLICATION Agent 与 AI）

HR 新消息 → REPLY 任务 → 大量会话在模型前被 stop → 无动作也记为 completed

结果与反馈 → 数据库存档 / UI 展示
             （通常不生成复盘，也不影响下一次投递）
```

## 当前组成

| 组件 | 当前职责 | 不负责 |
| --- | --- | --- |
| Chrome MV3 扩展（TypeScript/Vue） | BOSS 页面读取、本地硬规则、任务提交、经授权的平台动作、被动证据采集 | 服务端模型计算、持久工作流 |
| Python API 9100（FastAPI） | 身份、配置、简历、模型路由、筛选/回复/复盘计算、任务状态、结果和职业数据 | 控制浏览器或直接发送 BOSS 消息 |
| Python Agent 9101（LangGraph） | 轮询租约、驱动 gather/compute/validate/persist、等待动作回执或人工确认、重启恢复 | 语义推理和模型调用；这些仍在 9100 API |
| MySQL | 用户、会话、任务、动作、快照、结果、反馈、职业记录 | 主动触发任何闭环 |

旧 `ai-job-hunting-server/` Java 工程已删除，构建和 Compose 没有 Java 依赖。

## P0：直接影响主要功能

### 1. 实际投递绕过 APPLICATION Agent、Python 筛选与 AI

- `ai-job-hunting-ui/src/platform/platform.ts:1635-1640` 在 unified 模式只把 `FilterInput` 写入内存 Map，且固定 `prompt: ''`。
- 生产代码没有读取该 Map。
- `ai-job-hunting-ui/src/platform/platform.ts:1835-1898` 直接调用 BOSS `friend/add.json`。
- `ai-job-hunting-ui/src/platform/unifiedHandlers.test.mjs:150-171` 反而把“APPLICATION 提交 0 次、直接联系 1 次”固化为回归行为。
- Python 的 APPLICATION 计算仍存在于 `ai-job-api/src/job_helper_api/automation/computation.py:79-98`，但当前没有生产调用入口。

运行证据：176 个历史 APPLICATION 任务全部产生于 2026-09-08 至 09-09；09-09 的回退提交删除入口后再无新任务。1317 个投递快照中没有 AI 筛选结果。

### 2. “附加 AI 筛选条件”是无效配置

- `af/afE` 只在类型和偏好表单中出现，没有运行时消费者。
- 前端提交的筛选提示始终为空。
- `ai-job-api/src/job_helper_api/filtering.py:240-241` 遇到空提示会直接返回 `LOCAL_RULES_V2`，不会调用模型。
- `minMatchScore` 虽在契约中定义，但筛选实现不执行阈值淘汰。

因此界面可以保存“附加 AI 筛选条件”和最低分，但两者目前都不会控制投递。

### 3. 人工发过一条消息，会永久挡住后续 HR 追问

- `ai-job-hunting-ui/src/webSocket/hookMain.ts:455-475` 把任意被识别为人工发送的消息写成当前会话 `stop=true`。
- `ai-job-api/src/job_helper_api/automation/computation.py:100-102` 在模型调用前发现 stop 后直接结束。
- 无动作任务随后被工作流当作 `COMPLETED`，浏览器再把消息标记为已处理。

用户截图中的 17:01 追问与本地记录精确一致：该 REPLY 任务在两秒后成为 `COMPLETED/STOP`，原因是“当前会话或 AI 回复已暂停”，模型没有收到问题。

运行数据：329 个 REPLY 任务中 240 个 completed，但只有 8 个完成了 SEND；232 个 STOP 中有 225 个在模型前被暂停。当前还有 796 个会话 stop=true。

### 4. 自动回复没有完整的真实聊天历史

- REPLY 提交只携带当前问题和简单岗位资料；API 再从 `msg_session` 冻结历史。
- `msg_session` 只在 AI 文本得到平台 ACK 后写入“HR 问题 + AI 回答”。
- 用户手动发送、STOP、SUPERSEDED 等消息不会进入这份模型历史。
- 浏览器虽然观察到双方消息，但主要送入结果分析旁路，没有形成 REPLY 共用的会话时间线。

所以即使解除永久 stop，模型仍看不到截图中用户此前说过的“地点可以接受、离得近”等内容，跟进回答仍容易割裂。需要按精确 MID、参与者与 conversationKey 保存统一双向时间线，再为每个 REPLY 冻结最近的已验证上下文。

### 5. 投递快照、结果和职业记录没有可靠汇合

- direct 投递主要只写旧投递快照；真正的 CONTACT_JOB ACK 才会创建精确的 career application/event。
- 1317 个快照只有 368 个 career application；923 个快照晚于最后一条 career application。
- 420 个 outcome case 中，274 个当前无法精确匹配 career application，未匹配时职业投影直接返回。
- 拒绝报告中的原因、风险、建议，以及人工更正，不会进入后续职业策略输入。

结果数据因此更多是“存档和展示”，不是 Agent 可消费的学习资料。

## P1：架构和恢复能力不足

### 6. CAREER_REVIEW 只可手动创建，且当前没有产生任何策略

- UI 要求用户填写目标和预算后点击按钮才创建复盘；没有按新结果或周期自动创建的入口。
- 当前数据库中 CAREER_REVIEW job、strategy plan、resume proposal 都是 0。
- 即使手动批准策略，当前投递绕过 APPLICATION，因此 `strategyPlanId` 不进入真实投递。
- 回复提示词也不读取 outcome 或 active strategy；准备的简历版本没有与实际平台简历附件建立可验证映射。

### 7. Agent 只是耐久工作流驱动器，健康不代表业务有效

`ai-job-agent/src/job_helper_agent/automation_graph.py` 的节点主要通过 HTTP 调用 API。模型调用位于 Python API，而不是 Agent。Agent 每五秒轮询；空轮询也会更新 `lastSuccessfulClaimAt`，所以 health=ready 只能证明 API 可达和循环存活。

审计时 backend 与 agent 都 healthy，但 agent 的 `lastCompletedAt` 为 null，投递筛选任务也没有生产者。监测任务“看起来在跑”不等于检测到了可处理业务。

### 8. 错误分类、日志和重试预算不足

- 自动化 workflow 把多类 `ApiError` 统一改写为 `MODEL_UNAVAILABLE`，丢失认证、配置、协议或真正超时之间的区别。
- 前端多处静默吞掉轮询错误，任务界面把不同根因压成相似提示。
- 最近 24 小时 Agent 日志主要是 health 请求，无法按 job/request/model stage 追踪问题。
- 模型路由、Agent 节点和任务重领各自有重试，理论上可叠乘到 27 次 provider 调用；目前缺少一个持久化的任务总预算。

需要贯穿记录脱敏后的 `requestId/jobId/task/modelAlias/attempt/duration/failureClass`，并明确哪些错误可重试。

### 9. 未读恢复、浏览器上下文与队列恢复不完整

- 未读恢复每 15 秒检查一次，但只读取当前选中聊天的最后一行；其他未读联系人只计数，不创建可处理任务。
- WebSocket 消息一旦漏掉，只有用户正好打开对应会话并且该 HR 消息仍是最后一行，才可能补救。
- 服务端 job 创建成功后，浏览器才把 executor context 写入 localStorage；两步之间崩溃会留下服务端待执行任务，却无法从服务端列表重建本地执行上下文。
- 当前 direct 投递还绕开了 unified action 已有的 dispatch-before-effect、UNKNOWN 与晚到 ACK 对账保护。

应把可识别但正文尚未捕获的未读联系人持久化为 `DETECTED_NEEDS_CAPTURE`；当前会话可用时补齐 MID/正文。提交前先保存 pending requestId，服务端提供受当前页面身份约束的重新绑定；缺上下文必须明确显示，不能只等到过期。

### 10. 招呼语和任务面板容易造成能力错觉

- 当前自定义招呼语是偏好中的静态文本，不是 APPLICATION Agent 基于 JD、简历和策略生成的逐岗位内容。
- `COMPLETED` 同时表示“真正发送”“无需发送”和“会话已暂停”；任务面板会把大量 STOP 显示为分析完成。
- 统计没有完整区分 CANCELLED、SUPERSEDED、PAUSED、模型无效输出和平台已确认发送；同一计数桶内的 action 状态变化也可能不刷新列表。

界面应展示真实漏斗：检测到 → 已提交 → 模型已调用 → 草稿已生成 → 动作已派发 → 平台已确认，并分别说明暂停、策略不回复、失败、不确定和被新消息替代。

### 11. 模块测试通过，但关键业务契约缺少端到端测试

本次本地验证：UI 392 项通过，API 608 项通过（4 项 MySQL 条件测试跳过），Agent 208 项通过（19 项 MySQL 条件测试跳过），维护测试通过。CI 会配置隔离 MySQL 再运行条件测试。

这些测试主要证明模块内的幂等、安全边界和协议行为；没有证明“开始投递 → APPLICATION → AI/规则决策 → 浏览器动作回执 → career/outcome → 下一批策略变化”。甚至现有 UI 测试明确保护了绕过 APPLICATION 的行为。

## P2：长期维护风险

- 前端存在一个以 `axios.ts`、stores、`platform.ts`、`unifiedRuntime.ts` 为中心的循环依赖组件；初始化顺序和测试替身容易掩盖真实运行差异。
- Agent 当前单线程串行 claim；每处理一个任务仍固定等待扫描间隔。不同会话不能并发，突发消息下容易积压并产生 SUPERSEDED；当前已有 25 个 REPLY 被替代。
- `lastCompletedAt` 只保存在 Agent 进程内存，服务重启后健康页会显示 null，即使数据库存在历史完成时间。
- 模型路由诊断只保留最近 50 条事件，且未路由的直接调用没有统一事件记录；高频 conversation 会挤掉 filter/analysis 证据。
- AI 配置表允许同一用户存在多个 active 行，读取时只取较新记录；当前依赖环境配置回退仍可用，但迁移或恢复时可能选错配置。
- 现有健康检查主要验证“密钥存在、数据库可达”，不验证每类任务最近是否真实成功。

## 推荐修复顺序

1. 恢复唯一的 APPLICATION 主链：先提交和冻结输入，再由 API/Agent 给出决策；只有 CONTACT_JOB 获得授权后浏览器才可调用 BOSS。使用事件或有界等待，禁止恢复旧的无限轮询，也禁止失败时偷偷 direct contact。
2. 把 `afE ? af : ''` 和最低分语义接入服务端冻结与筛选；硬规则优先，UNKNOWN 必须 fail closed 并给可见原因。
3. 把人工接管从永久布尔值改为“已人工处理至某个 inbound MID”的水位或短租约；新 HR MID 自动恢复，同时保留显式永久暂停按钮。
4. 建立精确的双向会话时间线；STOP、人工消息和被新消息替代的内容也保留为上下文事实，但不因此取得发送授权。
5. 用 application cycle 统一 snapshot、CONTACT ACK、career application 和 outcome case；exact-only 回填，歧义必须显示而不能猜。
6. 只有已确认或已更正的结果才能形成版本化 CareerPolicySnapshot；下一批 APPLICATION、排序和回复提示词必须冻结并记录实际消费的策略版本。
7. 自动生成“待审阅”的周期复盘，但不自动改简历、不自动批准策略、不触发平台动作。
8. 修复未读/本地 context 恢复、按 conversationKey 分区并发和积压指标；已有任务时连续 claim，空队列才等待完整扫描周期。
9. 建立任务级总重试预算和可观测性；把 liveness、模型可用、各任务最近成功、业务效果分开展示。

## 必须新增的验收场景

- 完整离线链路：browser job → APPLICATION → decision → CONTACT ACK → career application → outcome → correction → policy v2 → 下一岗位决策发生可解释变化。
- Agent/API 超时或失联时，BOSS contact 调用次数必须为 0。
- 用户人工回复当前问题后，新 HR MID 可以重新触发 AI；同一旧 MID 不可重复发送。
- 三条人工消息后收到 HR 追问，模型请求必须包含顺序正确的真实上下文。
- 非当前选中的未读联系人会形成可见的待捕获任务；打开后可准确继续，不会串会话。
- API 成功创建任务但本地 context 尚未保存时崩溃，重启后仍可安全重绑或明确终止。
- `afE` 开关、空/非空 prompt、最低分、UNKNOWN 均有端到端断言。
- 多次投递同一岗位按 cycle 隔离，结果不会串到错误申请。
- 已确认更正会覆盖后续职业判断；低置信或无关结果不会改变策略。
- 未建立精确平台简历映射时，SEND_RESUME 必须阻止。
- 健康页能区分“worker 活着”“模型最近成功”“APPLICATION 最近成功”“career 闭环最近成功”。

本审计只使用代码、测试、健康端点、脱敏聚合和用户提供的截图；没有操作 Chrome 或 BOSS 页面。
