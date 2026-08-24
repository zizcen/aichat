# 创作工作台

这是一个独立的 React/Vite + Capacitor Android 客户端，面向已经部署的公共 API 网关。它不包含管理后台，也不依赖 Grok 登录；用户在首次启动时填写自己的 Base URL 和 Client API Key，请求直接发送到该网关。

当前开发基线和产品边界见 [`docs/01-产品需求文档.md`](docs/01-产品需求文档.md)、[`docs/02-接口文档.md`](docs/02-接口文档.md)、[`docs/03-技术栈与架构.md`](docs/03-技术栈与架构.md) 和 [`docs/04-开发交接与验收清单.md`](docs/04-开发交接与验收清单.md)。客户端实现位于 [`app/`](app/)。

## 本地开发

```powershell
cd app
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

开发服务器默认是 <http://127.0.0.1:5174/>。如需连接本地网关，可设置 `VITE_DEV_API_TARGET`；生产构建仍只接受 HTTPS Base URL。

## Android

```powershell
cd app
pnpm build
pnpm cap:sync
.Vandroid\gradlew.bat assembleDebug
```

Android 工程已设置 `minSdkVersion 26`、关闭自动备份和明文网络。API Key 在 Android 壳中由自定义 `SecureStore` Capacitor 插件使用 Android Keystore 加密；浏览器开发态只将加密密文放在本地存储，并把会话密钥留在当前浏览器会话中。

Android 构建要求 JDK 21+ 和 Android SDK 35；本机已完成创作工作台 v0.1.0 构建。真实 VPS 联调、真机弱网和发布渠道签名仍需在目标环境补齐。

当前本地构建的 APK 位于 `release/creative-workbench-v0.1.0.apk`，校验值见 `release/SHA256SUMS.txt`。

## MVP 范围

- 连接引导：`/healthz`、`/readyz`、`/v1/models`，错误保留 HTTP 状态和 `error.code`。
- 聊天：Responses SSE/JSON、推理折叠、工具活动、停止、重试、本地会话（50 条/约 4 MiB）。
- 图片：1–4 张、比例、1k/2k、URL 与 `b64_json`。
- 视频：异步 request ID、持久化索引、3 秒轮询、pending/done/failed、公网首帧 URL。
- 语音：TTS 二进制和 JSON+Base64、STT 系统文件选择器 multipart。

图片编辑、视频编辑/延长、录音和 Realtime WebSocket 属于后续版本。本 MVP 不调用任何 `/api/admin/v1/*`，也不上传本地图片/视频到管理端 staging。

## 安全边界

客户端只构造公共 `/healthz`、`/readyz` 和 `/v1/*` 请求。profile 只保存规范化 URL、Key 引用和 scope hash，不保存完整 Key；切换 profile 会隔离模型、会话和视频任务。归档媒体 URL 遵循公共网关的公开读取语义，不能当作 Bearer 保护链接。

隐私、权限和数据删除说明见 [`app/docs/隐私与权限.md`](app/docs/隐私与权限.md)。模型能力 fallback 及服务端 capability 兼容策略见 [`app/docs/模型能力映射.md`](app/docs/模型能力映射.md)。
