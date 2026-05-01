# OpenCopilot Worker Example (Browser)

直接启动：

```bash
bun run --cwd web dev
```

打开本地地址（通常是 `http://localhost:5173`），页面默认就是 `OpenCopilot Worker Example`。

## 使用步骤

1. 输入 OpenAI API Key。
2. 输入提示词并点击 **Send**。
3. 对话 loop 在 `web/src/opencopilot.worker.ts` 中执行，UI 在主线程渲染。

## 生产建议

- 不要在生产环境把 API Key 直接放主线程。
- 建议改成后端短期签名 / token 交换，或受控网关。
