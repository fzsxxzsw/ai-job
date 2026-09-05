
## AI工作猎手
<br/>

- **`找工作，用AI工作猎手！让AI帮您找工作！`** AI坐席：【DeepSeek+ChatGpt】赋能，ai助理作为您的求职者分身24小时 * 7在线找工作，并结合您的简历信息定制化回复。批量投递，自动发送简历，交换联系方式。hr拒绝挽留。高意向邮件通知，让您不错过每一份工作机会。
  <br/>
---

## 安装使用
- 运行 `pnpm install --frozen-lockfile && pnpm build` 生成 Chrome MV3 扩展。
- 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”。
- 选择本项目的 `.output/chrome-mv3` 目录；不再需要安装或启动油猴/暴力猴。
- 原 userscript 和 loader 仅作为迁移期历史文件保留，不进入扩展产物。
- 扩展无法读取油猴的私有存储；首次切换后请在助手界面重新确认个人设置。
- Boss首页没有功能面板，要在工作列表页面才有功能面板：[https://www.zhipin.com/web/geek/job](https://www.zhipin.com/web/geek/job)

## 功能介绍

### AI坐席
- \- 让AI作为您的求职者分身，帮助您快速找到工作。
- \- 智能回复HR的消息,结合您的简历信息进行定制化回答。
- \- 预设问题支持，根据场景只能匹配您的预设问题，进行智能回答。
- \- AI快捷回复发送简历，交换 wx、联系方式。
- \- HR拒绝挽留，当hr拒绝您时，可触发拒绝挽留。主动发送简历，并发送自定义的挽留语。

<br/>

### 工作通知
- \- 支持AI坐席与HR的每轮沟通，发送邮件通知。
- \- 高意向职位邮件通知，通过设置的关键字或者对话轮数，发送高意向职位的通知。

<br/>

### 投递工具
- \- 批量投递简历。自定义单次投递数量。
- \- 发送自定义招呼语，充分展现您的优势。
- \- 自定义筛选过滤，根据您的需求筛选公司，职位，薪资...。

<br/>

### AI坐席使用
- \- 购买ai坐席之后，可在AI助手中开启全局AI坐席功能。
- \- 开启全局AI坐席功能后，HR的消息将会自动转发给AI坐席进行智能回复。
- \- 可随时打断AI坐席的回复，当在web端或app端自己回复HR之后，当前会话的AI坐席将会自动停止。
- \- 停止后，可在web端的消息列表页面中点击【重启当前会话AI坐席】按钮，重新开启当前会话的AI坐席。
- \- 也可在web端通过快捷指令【start】输入到聊天框并发送，开启当前会话的AI坐席。boss端并不会收到当前消息。
- \- 当hr拒绝您时，可触发拒绝挽留。主动发送简历，并发送自定义的挽留语。
- \- 当hr通过boss向你交换联系方式时，ai助手自动交换。
- \- 可在偏好设置中设置预设问题，ai坐席根据场景智能匹配您的预设问题，进行智能回答。

<br/>

### 视频教程
- \- 点击下方链接观看视频教程。
- \- <a href="https://www.bilibili.com/video/BV1HKAyebESp" target="_blank">AI工作猎手使用教程</a>

### 常见问题
- \- 在boss更新简历之后，请重新导入简历。
- \- 脚本未运行，请尝试刷新页面。

---

# AI Job Hunting (AI工作猎手)

本项目是一个基于 Vue 3、Vite 和 WXT 的 Chrome MV3 扩展，旨在为“Boss直聘”提供 AI 赋能的求职辅助功能。

## 项目概览 (Project Overview)

*   **目标平台**：Boss直聘 (zhipin.com)
*   **核心功能**：
  *   **AI坐席**：自动回复 HR 消息，结合简历信息进行定制化回答。
  *   **WebSocket Hook**：拦截并解析 Boss 直聘的加密通信协议（Protobuf）。
  *   **自动化流程**：批量投递简历、自动交换微信/联系方式、高意向邮件通知。
  *   **智能过滤**：根据自定义规则筛选职位和公司。
*   **技术栈**：
  *   **框架**：Vue 3 (Composition API)
  *   **状态管理**：Pinia
  *   **UI 组件库**：Element Plus
  *   **构建工具**：WXT + Vite（Chrome Manifest V3）
  *   **协议处理**：Protobuf.js

## 核心架构 (Architecture)

1.  **隔离入口 (`entrypoints/job-helper.content.ts`)**：在 `document_start` 安装固定白名单消息桥并注入主世界包。
2.  **页面入口 (`entrypoints/job-helper-main.ts`)**：在页面主世界加载现有 `src/main.ts`，保留 UI、路由和 WebSocket Hook。
3.  **受控后台 (`entrypoints/background.ts`)**：只提供 `resume.download` 和 `deliveryAudit.report` 两个命名操作；后者仅能 POST 到 127.0.0.1:9100 的固定审计路径，浏览器扩展不访问 9101。
4.  **GM 兼容层 (`src/extension/gmCompat.ts`)**：用同步命名空间存储和受控消息桥替代项目实际使用的 GM API。兼容存储位于页面 MAIN world，只允许明确分类的非秘密状态；API Key、Authorization、Zp_token、token、secret 和 password 不会写入其中，旧 AI 配置镜像中的 API Key 会在启动时清除。
5.  **平台逻辑 (`src/platform/bossPlatform.ts`)**：封装平台特有的操作逻辑，如消息处理、简历发送。
6.  **协议层 (`src/webSocket/protobuf.ts`)**：处理 Boss 直聘专有的 Protobuf 协议数据。

## 开发与运行 (Development & Running)

### 环境要求
*   Node.js 20.12+
*   pnpm (推荐使用)

### 常用命令
*   **安装依赖**：`pnpm install`
*   **开发模式**：`pnpm run dev`（WXT Chrome 扩展开发模式）
*   **类型检查**：`pnpm run typecheck`
*   **生产构建**：`pnpm run build`（产物位于 `.output/chrome-mv3`，并自动执行安全契约校验）
*   **仅构建扩展**：`pnpm run build:extension`（WXT 构建成功后立即执行同一安全契约校验）

## 开发约定 (Development Conventions)

1.  **Hook 机制**：修改原有网站行为时，优先使用 `src/webSocket/hookMain.ts` 中的拦截器，避免直接操作 DOM。
2.  **日志记录**：使用 `src/logging` 提供的 `logger` 进行调试，关键运行数据应记录到 `LogRecorder` 中。
3.  **页面边界**：页面 Hook 留在主世界；扩展权限仅能通过 `src/extension/pageBridge.ts` 的固定协议访问。
    当前为了最小化迁移仍保留 MAIN-world 业务包，因此页面可以看见其中的非秘密运行状态；完整 isolated-world UI 拆分属于后续加固，不阻断本地替代油猴。后台服务和 BOSS 会话密钥不得进入 GM 兼容存储。
4.  **Protobuf 更新**：`proto/chat-protocol.proto` 是协议的唯一来源。`pnpm protobuf:generate` 只更新静态模块和类型声明，并拒绝与已提交 wire/descriptor golden 不一致的协议变更；普通生成不会覆盖 golden。确需接受协议变更时，先人工审查字段编号，再显式运行 `pnpm protobuf:update-golden`，随后运行 `pnpm protobuf:generate`。`pnpm protobuf:check` 会同时检查静态 codec、wire golden 和完整 descriptor snapshot；运行时只加载静态生成代码，不包含反射 parser。
5.  **异步操作**：与 AI 交互通常耗时较长，务必处理好超时和并发控制（参考 `AiPower.ask` 的超时配置）。

### Protobuf 迁移说明

- 旧 `src/webSocket/protobuf.ts` 的 `protoDefinition` 内部导出已移除；仓库内没有调用者，README 也未将它承诺为公共 API。需要查看或生成协议时，请直接使用 `proto/chat-protocol.proto`。
- `protobufjs`、`protobufjs-cli`、`long`、`acorn` 和 `wxt` 使用精确版本；golden 中的版本元数据从本机已安装包读取，避免依赖升级后仍写入旧版本号。
- 构建会精确禁用 `long` 内嵌的 WebAssembly 优化并使用其 JavaScript fallback；扩展契约会拒绝 `WebAssembly`、`.wasm` 和字符串代码生成。

## 关键文件 (Key Files)

*   `wxt.config.ts`: 定义精确匹配范围、MV3 权限、CSP、构建版本和 `$` 兼容别名。
*   `src/extension/bridgeProtocol.ts`: 定义页面、隔离世界和后台之间的类型化白名单协议。
*   `src/platform/bossPlatform.ts`: 实现 `Platform` 接口的核心类。
*   `src/webSocket/hookMain.ts`: WebSocket Proxy 实现逻辑。
*   `src/stores/remote.ts`: 处理与后端服务的状态同步。

## TODO / 扩展计划
*   [ ] 适配更多招聘平台（如前程无忧、猎聘）。
*   [ ] 优化 AI 提示词算法，提升回复准确度。
*   [ ] 增强验证码自动识别与绕过机制。
