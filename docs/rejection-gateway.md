> 历史架构说明：下文描述 `rejection-v0.1.0` 的 Java 登录网关 → Agent 拒绝分析方案。
> 从本次完整 Python 移植起，9100 由 `ai-job-api` 直接处理身份和拒绝分析，
> Agent 不再重复承载拒绝分析引擎，也不再需要 `docker-compose.rejection.yml` 或网关签名。
> 当前数据库计划命令为 `python -m job_helper_api.migrate`，应用命令加 `--apply`；
> 本地发布流程见 [本机部署说明](../本机部署说明.md)，采用先本地验收、后 GitHub 归档。
> 下文保留用于核对历史提交，不能作为当前部署命令。
# 拒绝分析：同一个 9100 入口，Python 处理业务

## 交付边界

本改动不切换整套 Java 后端，不依赖未提交的 ai-job-api 迁移。
浏览器继续使用 9100；Java 只负责现有登录校验、固定接口转发和短期身份签名。
拒绝分析、快照、报告保存、反馈和汇总在现有 ai-job-agent 的 rejection 模块完成。
这是手动分析第一阶段，不包含自动识别拒绝、LangGraph 分析子图或浏览器执行器。
不会自动回复招聘方、投递岗位、发送简历或改变求职策略。

## 接口

| 浏览器通过 Java 调用 | Python 内部接口 |
| --- | --- |
| POST /api/job/ai/applications/snapshot | POST /internal/rejections/snapshot |
| POST /api/job/ai/rejections/analyze | POST /internal/rejections/analyze |
| POST /api/job/ai/rejections/{id}/feedback | POST /internal/rejections/reports/{id}/feedback |
| GET /api/job/ai/rejections/{id} | GET /internal/rejections/reports/{id} |
| GET /api/job/ai/rejections/history | GET /internal/rejections/history |
| GET /api/job/ai/rejections/summary | GET /internal/rejections/summary |
| GET /api/job/ai/rejections/status | GET /internal/rejections/status |

现有 0.0.64 扩展的分析、快照和反馈请求无需改地址。新增历史查询接口只提供最近20条元数据，
不代表本次已新增历史报告列表页面。分析重复请求会返回已保存报告。

## 身份与安全

用户编号仅取自 Java LoginFilter 建立的 HeaderContext。客户端的身份头不转发，JSON多余字段拒绝。
HMAC-SHA256 同时绑定用户、方法、固定路径、UTF-8原始正文摘要、时间和nonce；凭据30秒内有效。
Python 再校验用户是否启用。nonce 存入 MySQL，防重放记录跨进程重启保留。
内部接口拒绝浏览器 Origin、查询参数和任意转发地址。现有 Agent 的 X-Internal-Token 不能代替签名。
报告读取、反馈、快照和趋势都按已认证用户隔离。内部验签失败不会清掉浏览器登录。
模型调用只允许服务端配置的HTTPS域名；默认10秒截止。错误、超时和无效证据明确回退规则分析。
电话号码、邮箱等先脱敏；不能声称所有自然语言个人信息都可自动匿名化。

## 证据与历史兼容

同时使用HR原话、当前会话、岗位基本信息、完整描述的受限摘录和投递时简历快照。
推断须同时有岗位与简历证据，学历/院校只能引用HR明确表达。模型不能伪造证据或数字。
历史对话没有快照时允许保存报告，applicationSnapshotId 为 null；只报告明确内容和资料缺失。
新快照只接受近5分钟的事件，不用当前简历补造旧投递历史。已有快照不可覆盖。
没有任何图节点会在此阶段创建 CONTACT_JOB 动作。

## 数据库兼容迁移：必须显式执行

先备份并验证恢复能力，再运行 `python -m job_helper_agent.rejection.migration` 查看计划。
确认后使用 `python -m job_helper_agent.rejection.migration --apply`。
该命令复用 Agent 的数据库连接配置，不输出密码；不会在应用启动时执行。
缺少快照/分析表时创建兼容表；已有表保留全部记录，仅将 application_snapshot_id 放宽为可空。
新增 rejection_gateway_nonce 防重放表。新的大文本字段使用MySQL LONGTEXT。
不会修改 user_info、user_resume、user_ai_config 或 agent_action 数据。
它不属于 Alembic 的 agent_* 工作流表迁移；不要用自动生成的drop计划删除业务表。

## 发布与回退

功能默认关闭。必须先将本次独立提交推送到 GitHub，并通过对应 Java、Agent 和扩展回归检查。
从该已通过的Git提交构建 Java 和 Agent 镜像，而不是从带有整套Python迁移草稿的组合配置启动。
使用同一份服务端 REJECTION_GATEWAY_SECRET（随机且至少32字符），不能写入Git或前端。
将 docker-compose.rejection.yml 叠加到该提交的 docker-compose.local.yml，显式迁移后启用
REJECTION_GATEWAY_ENABLED=true。扩展仍连接9100，内部服务没有新浏览器权限。
先通过隔离数据库和固定测试数据验收，再在维护时段更换主后端/Agent；本文件本身不代表已部署。

回退时关闭 REJECTION_GATEWAY_ENABLED 并恢复前一组镜像即可。保留新报告和nonce表，
不要通过删除记录或把可空字段强制改回NOT NULL来回退。Java登录和现有AI回复路径未重写。

## 验证范围

测试包含签名黄金向量（Java/Python一致）、防伪造、防重放、用户隔离、旧报告读取、
无快照分析、快照不可覆盖、模型失败降级、证据校验及MySQL兼容迁移。
真实浏览器会话、自动投递和自动回复不是本次测试的组成部分。
