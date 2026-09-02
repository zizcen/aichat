# Android 输入法布局方案

本项目是 Capacitor Android 壳，输入法避让只在 Android 原生层处理；不为独立 Web 端复制一套键盘动画。

## 参考原则

- RikkaHub 的输入区使用 `imePadding()` 与 `navigationBarsPadding()`，让系统 inset 成为唯一边界。
- RikkaHub 的消息列表监听 `WindowInsets.ime`，只按键盘高度变化量滚动，避免每一帧重复叠加完整高度。
- Android Activity 使用 `adjustResize`，API 30+ 用 `WindowInsetsAnimationCompat` 同步过渡。

参考源码：

- https://github.com/rikkahub/rikkahub/blob/master/app/src/main/java/me/rerere/rikkahub/ui/components/ai/ChatInput.kt
- https://github.com/rikkahub/rikkahub/blob/master/app/src/main/java/me/rerere/rikkahub/ui/hooks/ImeAutoScroller.kt

## 本项目职责

`MainActivity`：

- 开启 edge-to-edge 与 `SOFT_INPUT_ADJUST_RESIZE`。
- 在 Capacitor 根容器统一应用状态栏、导航栏和 IME inset，避免 WebView/页面重复加边距。
- 在 IME 动画的 `onProgress` 中逐帧更新容器 padding；动画结束后再应用最终 inset，避免首帧跳动。
- 通过 `creative-workbench-ime` 事件把键盘高度差通知页面。

`src/features/creative-console/android-ime.ts`：

- 仅当 Capacitor 平台为 Android 时启用。
- 聊天列表原本贴近底部时，按原生事件的正向增量滚动；用户查看历史消息时不抢夺滚动位置。
- 桌面预览仍可使用旧的 `visualViewport` fallback，但 Android 不会同时运行两套高度补偿。

不要在 Android 页面重新给整页设置键盘高度或 transform；这会导致输入框瞬移、消息重叠和透明层问题。
