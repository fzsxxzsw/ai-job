# AI 工作猎手 · 本机 Python 版

当前维护的是 Chrome MV3 扩展和单套 Python 本机后端。扩展继续连接 `http://127.0.0.1:9100`，无需改为 9101 或另建桌面工程。旧 Java 工程已从当前代码树删除。

```text
当前 Chrome 扩展
    → 读取 BOSS 页面、执行本地硬规则及经授权的平台动作
    → Python 业务 API（9100）：登录、简历、配置、模型调用、任务状态、结果与职业数据

Python LangGraph 工作流 Agent（9101）
    → 通过内部 API 驱动任务收集、计算、校验、保存、等待回执或确认及故障恢复
    → 不直接调用模型，不控制 Chrome，也不发送 BOSS 消息

MySQL
    → 保存个人资料、会话、自动化任务、投递快照、结果报告、反馈及职业记录
```

启用[投递结果工作流](docs/application-outcomes.md)后，扩展被动收集可确认的会话证据，API 建立任务，Agent 用 LangGraph 完成收集、计算、校验、保存和持久等待；模型能力由 9100 API 提供。明确拒绝会分析原因，肯定答复只记录有证据的下一步信号，不等于已录用。后端不自动控制 Chrome 或发送 BOSS 消息。当前投递、回复与职业反馈链路的已知断点见 [2026-09-16 Agent 与 Python 健壮性审计](docs/audits/2026-09-16-agent-python-robustness.md)。

已读或未读后没有回复，需要精确消息状态、可靠发送时间和最新会话覆盖证据；计时结束本身不能生成“不回复”或拒绝结论。当前真实平台终端适配器的完整 read/coverage 证据尚未取得，不能把合成测试通过写成这部分已完成实际验收。

## 本机构建与版本管理

按 [本机部署说明](本机部署说明.md) 配置现有数据库账号和 `.env`。正常流程先完成本地测试，再提交并推送 GitHub；对应 GitHub Actions 全部成功后，才允许构建和发布到本机运行环境：

```powershell
.\build-job-helper.ps1
.\release-job-helper.ps1
.\status-job-helper.ps1
```

数据库兼容调整只在明确指定 `release-job-helper.ps1 -ApplyMigrations` 时进行，并且先停写、做新鲜备份，再迁移。日常 `start-job-helper.ps1` 和 `stop-job-helper.ps1` 仅启停当前容器。

Chrome 始终使用现有 `job-helper-wxt-local-extension` 目录。只保留 `current` 和一份 `previous` 退路；完整历史由 Git 管理。每个本地版本在 API、Agent、扩展 manifest 中使用同一版本和 build ID，回执记录精确镜像 ID 与源文件摘要。

## 目录

| 路径 | 用途 |
| --- | --- |
| `ai-job-api/` | 9100 Python 业务后端与唯一拒绝分析引擎 |
| `ai-job-agent/` | 9101 LangGraph 结果报告与持久人工确认工作流 |
| `ai-job-hunting-ui/` | Chrome MV3 扩展和兼容静态产物 |
| `ai-job-api/schema.sql` | 新建测试/安装数据库的基础结构；现有库用显式兼容迁移 |
| Git 历史中的 `ai-job-hunting-server/` | 已删除的旧 Java 实现；仅在历史提交中保留，不参与构建或运行 |
| `docs/rejection-gateway.md` | 已被 Python 单一 API 取代的网关历史说明 |

此分支用于个人自托管，支付、试用、邀请和商业坐席销售接口停用。可选邮件通知默认关闭，配置真实 SMTP 后由明确业务调用触发。旧部署指南、旧油猴文件和 Java 实验配置只保留在 Git 历史中，不能据此再启动第二套正式服务。

项目沿用原 AI Job Hunting 的界面与求职流程。运行状态以本地健康检查、回执和实际验收记录为准，README 不代表某台电脑已完成部署。
