# 多模型与免费额度

Python API 的岗位筛选、招呼语、对话回复和拒绝原因分析通过同一个模型调度器。
在「AI 配置 → 多模型与免费额度」导入额度，勾选模型和参与任务，再启用自动选模。
默认关闭自动选模；关闭时保持原来的固定模型配置。

## 目录与能力

预置目录包含已核对的 2026-09-07 截图中所有模型 ID。没有把截图未展示的 181 个
大语言模型条目猜成已授权模型。导入新模型快照会添加对应条目。
当前支持百炼北京地域 `https://dashscope.aliyuncs.com/compatible-mode/v1` 的
Chat Completions。非实时 Omni 通过 SSE 接收文本输出并收集 usage；不会生成音频。
实时语音、OCR/GUI 和翻译/数学等专用模型保留在目录中，标明不参加当前通用求职任务。
模型支持的任务是保守的初始分类，连接测试通过只代表能调用，不代表任务质量评测通过。

百炼兼容接口不提供 `GET /models`。目录接口明确返回 `bundled_catalog`，
不能作为某个 Key 的实时权限清单，也不伪造免费余额查询接口。

## 额度和费用保护

只给已确认在百炼打开「免费额度用完即停」的模型启用自动分配。
程序不会修改控制台开关，也不会在模型池不可用时改用未记账的默认模型。
准确账单及其他应用/业务空间/API Key 的消耗仍以百炼控制台为准。

额度快照支持以下 JSON，`observedAt` 必须保留真实查看时间和时区：

```json
{"snapshots":[{"id":"qwen-turbo","remainingTokens":1000000,"expiresOn":"2026-10-01","observedAt":"2026-09-07T13:36:00+08:00","freeOnlyConfirmed":true}]}
```

剩余量显示为导入余额减去本地用量的**估算**。成功响应优先使用供应商返回的
`usage.total_tokens`（包含计入总数的推理用量）。没有 usage 或请求结果不确定时，
保留由 UTF-8 输入长度、输出上限及消息开销形成的保守预留。实际停费依赖供应商开关。
到期日当天起停止选择该条目，避免依赖未明确的到期时刻。

配置、额度和最近 50 条调用元数据存放在现有 `py_api_control` 中，无新增数据库迁移。
数据按用户和连接凭证的不可逆指纹隔离。日志/调用记录不保存密钥、提示词、简历或回复内容。
每个请求在数据库锁内先预留额度，网络请求在锁外执行，完成后再按 usage 结算。
崩溃留下的预留仍计入估算消耗。重复或更早的快照不恢复额度；进行中的请求阻止余额校准。
界面保存使用 revision 检查，防止旧页面覆盖新配置。

## 分配与失败处理

- 「任务适配优先」按人工优先级、模型系列对任务的初始适配、到期日和上次使用时间排序。
- 「临近到期优先」先比较到期日，再比较任务适配和优先级；同等级条目轮换。
- 只有明确的 HTTP 403 + `AllocationQuota.FreeTierOnly` 才记为免费额度耗尽。
- 普通 401/403 停止本次调用，不轮换来掩盖密钥/权限错误。
- 429 冷却 60 秒；超时或临时服务故障冷却 30 秒。不存在或请求不兼容的模型等待人工复测。
- 总尝试数 1–5，整次调用等待 5–120 秒；业务逻辑只接收一个最终回复，不重复产生可发送草稿。
- 拒绝分析保存实际返回结果的模型名；既有证据校验和对话停止检查仍生效。

## 接口

所有接口沿用当前登录凭证；写操作在只读模式下被拒绝。

| 接口 | 功能 |
| --- | --- |
| `GET /api/user/ai/routing` | 配置、能力、额度估算、运行状态和调用记录 |
| `POST /api/user/ai/routing` | 保存模型池及任务策略 |
| `POST /api/user/ai/routing/quotas` | 校准/批量导入额度快照 |
| `POST /api/user/ai/routing/discover` | 返回预置目录，明确标注非实时 |
| `POST /api/user/ai/routing/test` | 对单个模型发送小型合成请求并记账 |

## 验证与发布

测试覆盖额度错误切换、权限错误停止、限流冷却、重复快照、并发预留、重启恢复、
凭证隔离、专用任务隔离、认证/只读边界以及流式文本和 Token 统计。
使用 GitNexus impact 检查所有既有调用入口，提交前执行 detect-changes。
本次遵循会话授权的顺序：本地单元测试 → 提交并推送 → GitHub checks 成功 → 本地构建/发布。
Chrome 扩展目录只更新现有 `job-helper-wxt-local-extension`。浏览器重载和可见徽标验证
需要具体的浏览器授权，文件发布本身不代表浏览器已经加载该版本。

## 官方依据

- [免费额度与用完即停](https://help.aliyun.com/zh/model-studio/new-free-quota/)
- [Chat Completions、stream_options 与 modalities](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
- [兼容接口不提供 GET /models](https://help.aliyun.com/en/model-studio/deepseek-harness)
