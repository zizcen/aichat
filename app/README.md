# Grok2API 创作工作台客户端

## 支持版本

协议按 grok2api `v3.1.4` 公共接口快照实现。真实部署可能增加或删减能力，连接页以用户 Key 返回的 `/v1/models` 为准；未知模型仍可在各工作区手动输入。

## 开发命令

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

`VITE_DEV_API_TARGET` 可把 Vite 的 `/healthz`、`/readyz`、`/v1` 代理到本地网关。Debug Web 构建允许 HTTP 以便局域网联调；Release Android 构建强制 HTTPS。

## Android 构建

先安装 JDK 21+、Android SDK 35（并设置 `ANDROID_HOME` 或 `android/local.properties` 的 `sdk.dir`）和 Gradle 所需组件：

```powershell
pnpm build
pnpm cap:sync
.\android\gradlew.bat assembleDebug
```

生成的 Debug APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`。发布签名只从 CI Secret 或本机安全配置注入，仓库不提交密钥。

本地签名 Release：先生成/放置 `app/.signing/grok2api-release.jks`，设置 `GROK2API_KEYSTORE_PASSWORD`（以及可选的 `GROK2API_KEY_PASSWORD`），再运行 `pnpm android:release`。未配置签名环境变量时，Release 任务不会静默伪装成已签名包。

## 已知限制

- 公共 `/v1/models` 在旧版只返回 OpenAI 风格字段，没有 provider/capability；客户端使用服务端可选字段、内置模型名 fallback 和手动输入，不把猜测当成硬权限。
- 图片编辑支持在 APK 内选择本地图片并以内存 `data:image/*` 提交公共 `/v1/images/edits`；视频 MVP 仍只接受公网 `image.url`、参考 URL，未启用管理端 staging 上传。若服务端只返回 `/v1/videos/{request_id}/content`，播放器/下载请求必须带 Bearer。
- 视频轮询在页面前台运行，切后台会停止页面连接并在恢复后继续；长时间后台任务应在后续版本接入 WorkManager。
- Android 原生 SecureStore 已提供 Keystore 加密实现；浏览器 fallback 为开发便利方案，刷新浏览器后需要重新输入 Key。
- Android 壳使用自定义 NativeHttp 传输绕过 WebView CORS，并保持 Responses SSE 的逐块读取和取消；普通请求、multipart 和媒体保存也不依赖网关开放 `https://localhost` CORS。
- 移动端 STT 文件上限为 10 MiB；大体积图片响应优先使用服务端 URL，避免跨 JS/native bridge 复制过大的 Base64。
