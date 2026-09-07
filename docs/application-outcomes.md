# 投递结果与人工确认工作流

扩展继续使用 `http://127.0.0.1:9100`。Python API 保存观察事实、任务、报告和反馈；9101 Agent 通过内部鉴权运行真实 LangGraph，不控制浏览器、不发送消息，也不自动修改简历或投递策略。

## 流程与证据

已有投递快照的岗位可以登记为等待；快照和本地发送动作本身都不是平台发送成功的证明。被动消息、可关联的发送回执和明确会话绑定形成观察事件，通过持久 outbox 重试。重复事件沿用首次观察时间，不会刷新证据或重复创建任务。

普通 HR 对话是 `REPLIED`。有证据的面试邀请、推进安排是 `POSITIVE`，不代表已录用。明确拒绝是 `REJECTED`，自动进入现有拒绝原因引擎；HR 原话、岗位描述和投递时简历仍分别作为证据，缺失历史资料时明确保留未知信息。模型不可用或结论未通过证据校验时，报告如实使用 `RULES_ONLY`。

Agent 的工作流为收集 → 分析 → 校验 → 保存 → 持久等待人工确认 → 反馈恢复 → 完成。API 是报告的唯一写入方。保存成功后，Agent 先持久化 LangGraph interrupt，再把任务停在等待确认；确认、纠正或忽略使对应报告版本可被重新领取并恢复。进程重启可以复用已保存的 artifact 和报告，旧版本任务或反馈不能覆盖新版本。模型响应到达后、artifact 保存前发生进程崩溃，仍可能需要再次调用模型，不承诺计费恰好一次。

## 已读、未读和未回复的边界

默认已读等待 24 小时、未读等待 72 小时。这些是判断条件的一部分，不是拒绝推断器。

- 必须是具体、已获平台发送确认的用户消息，并有可信发送时间。
- READ/UNREAD 必须指向这条消息；发送 ACK 不等于已读，平台 `MessageRead` 表示用户读 HR 时也不能反向当作 HR 已读。
- 必须轮到 HR 回复，且最新会话覆盖证据证明在计时截止后仍无后续 HR 消息。
- 缺少截止后的可靠覆盖时进入 `WAITING_OBSERVATION`，保留最后一次真实证据时间。断网、缓存重放、心跳和队列重试都不会刷新这个时间。

当前真实平台终端适配器的完整 read/coverage 证据尚未取得，自动已读不回、未读不回的实际验收仍受这个边界限制。不能用本地合成事件或状态卡出现来宣称真实平台证据已经接通。

## 规范本机配置

`.env.example` 提供以下选项；真实密钥只保存在未跟踪的 `.env`。

| 配置 | 默认值与用途 |
| --- | --- |
| `API_OUTCOME_ENABLED` | `false`；同时控制 API 和 Agent outcome worker |
| `API_OUTCOME_INTERNAL_TOKEN` | 可留空复用已配置的 `AGENT_INTERNAL_TOKEN`；单独配置时须至少 32 字符 |
| `API_OUTCOME_READ_WAIT_HOURS` | `24`；允许 1–720 小时 |
| `API_OUTCOME_UNREAD_WAIT_HOURS` | `72`；允许 1–720 小时 |
| `API_OUTCOME_LEASE_SECONDS` | `180`；允许 30–600 秒 |
| `AGENT_OUTCOME_SCAN_SECONDS` | `5`；单 worker 领取间隔，允许 1–60 秒 |
| `AGENT_OUTCOME_JOB_TIMEOUT_SECONDS` | `300`；单任务上限，允许 150–600 秒 |

Compose 固定将 Agent 的 `AGENT_OUTCOME_API_URL` 设为 `http://backend:9100`，使用已有 Docker 网络和 `backend` 服务别名。两端 outcome 内部凭据始终由同一个服务端值派生，不下发浏览器。Agent 的内部 HTTP 请求超时为 150 秒，覆盖允许的模型调用时间；续租由独立短请求完成。

启用需将单一开关设为 `true`，本地构建通过后执行 `release-job-helper.ps1 -ApplyMigrations`。该命令停写并建立新鲜备份，再添加五张 `outcome_*` 表、更新现有服务及固定扩展目录；启动过程不执行 DDL。AI 回复暂停不禁用结果分析，但 `API_READ_ONLY` 或停用用户会阻止 worker 工作。结果分析开关不会启用投递、AI 回复或 SMTP。

## 验证与版本管理

`tests/outcome-runtime.tests.ps1` 只解析 Compose，验证默认关闭、独立密钥和复用旧密钥三种配置以及服务别名、端口、阈值与检查点卷。它使用临时假配置，不启动容器、不读取正式数据库、不调用模型；本地 build 和运维 CI 都执行此检查。

发布仍遵循本地测试 → 本地构建/发布/验收 → Git 提交推送。Chrome 始终使用现有固定目录，保留 current 与一份 previous 回退。修改 `.env` 后需显式重新发布；日常 `start-job-helper.ps1` 只启动当前容器，不会悄悄替换环境配置。

验收要核对 API 与 Agent 的版本/build ID、Agent `/health/ready` 中 `outcomeGraph`、`outcomeWorker` 及最近成功领取状态，并用隔离合成数据验证报告、人工确认后的 checkpoint resume 和重启恢复。真实数据库副本不能被 destructive fixture 重建。真实页面、扩展已加载版本和 read/coverage 平台证据必须分别核验；没有对应证据就保留未验收状态。
