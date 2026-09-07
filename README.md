# AI 工作猎手 · 本机 Python 版

当前维护的是 Chrome MV3 扩展和单套 Python 本机后端。扩展继续连接 `http://127.0.0.1:9100`，无需改为 9101 或另建桌面工程。

```text
当前 Chrome 扩展
    → Python 业务 API（9100）：登录、简历、配置、筛选、回复草稿、投递结果与拒绝分析
    → 现有 MySQL：个人资料、会话、投递快照、分析报告和反馈

Python LangGraph Agent（9101）：结果报告工作流、持久等待确认、反馈恢复；保留原岗位提议流程
```

日常筛选与回复仍由扩展调用业务 API。启用[投递结果工作流](docs/application-outcomes.md)后，扩展被动收集可确认的会话证据，API 建立任务，Agent 用真实 LangGraph 完成收集、分析、校验、保存和持久等待人工确认；反馈后恢复对应流程。明确拒绝会分析原因，肯定答复只记录有证据的下一步信号，不等于已录用。后端不自动控制 Chrome 或发送 BOSS 消息。

已读或未读后没有回复，需要精确消息状态、可靠发送时间和最新会话覆盖证据；计时结束本身不能生成“不回复”或拒绝结论。当前真实平台终端适配器的完整 read/coverage 证据尚未取得，不能把合成测试通过写成这部分已完成实际验收。

## 本机构建与版本管理

按 [本机部署说明](本机部署说明.md) 配置现有数据库账号和 `.env`。正常流程先本地测试、构建、发布和验收，再提交推送 GitHub：

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
| `ai-job-hunting-server/` | 旧 Java 源码，保留历史对照，不参与正常本机构建或运行 |
| `docs/rejection-gateway.md` | 已被 Python 单一 API 取代的网关历史说明 |

此分支用于个人自托管，支付、试用、邀请和商业坐席销售接口停用。可选邮件通知默认关闭，配置真实 SMTP 后由明确业务调用触发。旧部署指南、旧油猴文件和 Java 实验配置仅供历史参考，不能据此再启动第二套正式服务。

项目沿用原 AI Job Hunting 的界面与求职流程。运行状态以本地健康检查、回执和实际验收记录为准，README 不代表某台电脑已完成部署。
