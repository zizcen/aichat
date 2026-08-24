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

先安装 JDK 17+、Android SDK 35（并设置 `ANDROID_HOME` 或 `android/local.properties` 的 `sdk.dir`）和 Gradle 所需组件：

```powershell
pnpm build
pnpm cap:sync
.\android\gradlew.bat assembleDebug
```

生成的 Debug APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`。发布签名只从 CI Secret 或本机安全配置注入，仓库不提交密钥。

## 已知限制

- 公共 `/v1/models` 在旧版只返回 OpenAI 风格字段，没有 provider/capability；客户端使用服务端可选字段、内置模型名 fallback 和手动输入，不把猜测当成硬权限。
- 本地图片/视频上传暂不启用。视频 MVP 只接受公网 `image.url`、参考 URL；若服务端只返回 `/v1/videos/{request_id}/content`，播放器/下载请求必须带 Bearer。
- 视频轮询在页面前台运行，切后台会停止页面连接并在恢复后继续；长时间后台任务应在后续版本接入 WorkManager。
- Android 原生 SecureStore 已提供 Keystore 加密实现；浏览器 fallback 为开发便利方案，刷新浏览器后需要重新输入 Key。
