type ToolDef = {
  name: string
  description: string
  parameters: any
}

type WorkerInit = {
  type: 'init'
  apiKey: string
  baseURL?: string
  model?: string
  systemPrompt?: string
  tools?: ToolDef[]
}

type WorkerChat = { type: 'chat'; requestId: string; sessionId: string; message: string }
type WorkerToolResult = { type: 'tool_result'; requestId: string; toolCallId: string; output: string; isError?: boolean }

const state = {
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: undefined as string | undefined,
  tools: [] as ToolDef[],
  sessions: new Map<string, any[]>(),
  pending: new Map<string, (result: WorkerToolResult) => void>(),
}

async function runLoop(requestId: string, sessionId: string, message: string) {
  const session = state.sessions.get(sessionId) ?? []
  const history = [...session, { role: 'user', content: message }]
  const tools = state.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))

  for (let i = 0; i < 8; i++) {
    const resp = await fetch(`${state.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.apiKey}` },
      body: JSON.stringify({
        model: state.model,
        stream: false,
        messages: state.systemPrompt ? [{ role: 'system', content: state.systemPrompt }, ...history] : history,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      }),
    })

    const data = await resp.json() as any
    const assistant = data.choices?.[0]?.message
    const toolCalls = assistant?.tool_calls ?? []
    if (toolCalls.length > 0) {
      history.push({ role: 'assistant', content: assistant.content ?? '', tool_calls: toolCalls })
      for (const tc of toolCalls) {
        ;(self as any).postMessage({ type: 'tool_start', requestId, tool: tc.function?.name, args: tc.function?.arguments })
        const result = await new Promise<WorkerToolResult>((resolve) => {
          state.pending.set(`${requestId}:${tc.id}`, resolve)
          ;(self as any).postMessage({ type: 'tool_request', requestId, toolCallId: tc.id, tool: tc.function?.name, args: tc.function?.arguments })
        })
        history.push({ role: 'tool', tool_call_id: tc.id, content: result.output })
        ;(self as any).postMessage({ type: 'tool_result', requestId, toolCallId: tc.id, output: result.output, isError: result.isError ?? false })
      }
      continue
    }

    const text = assistant?.content ?? ''
    ;(self as any).postMessage({ type: 'text', requestId, text })
    ;(self as any).postMessage({ type: 'done', requestId, fullText: text })
    state.sessions.set(sessionId, [...history, { role: 'assistant', content: text }])
    return
  }

  ;(self as any).postMessage({ type: 'error', requestId, error: 'Loop exceeded max turns' })
}

self.onmessage = async (event: MessageEvent<WorkerInit | WorkerChat | WorkerToolResult>) => {
  const msg = event.data as any
  if (msg.type === 'init') {
    state.apiKey = msg.apiKey
    state.baseURL = msg.baseURL ?? state.baseURL
    state.model = msg.model ?? state.model
    state.systemPrompt = msg.systemPrompt
    state.tools = msg.tools ?? []
    return
  }

  if (msg.type === 'tool_result') {
    const key = `${msg.requestId}:${msg.toolCallId}`
    const resolve = state.pending.get(key)
    if (resolve) {
      state.pending.delete(key)
      resolve(msg)
    }
    return
  }

  if (msg.type === 'chat') {
    await runLoop(msg.requestId, msg.sessionId, msg.message)
  }
}
