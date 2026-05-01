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

const state: {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt?: string
  tools: ToolDef[]
  sessions: Map<string, any[]>
} = {
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: undefined,
  tools: [],
  sessions: new Map(),
}

self.onmessage = async (event: MessageEvent<WorkerInit | WorkerChat>) => {
  const msg = event.data
  if (msg.type === 'init') {
    state.apiKey = msg.apiKey
    state.baseURL = msg.baseURL ?? state.baseURL
    state.model = msg.model ?? state.model
    state.systemPrompt = msg.systemPrompt
    state.tools = msg.tools ?? []
    return
  }

  if (msg.type === 'chat') {
    const session = state.sessions.get(msg.sessionId) ?? []
    const history = [...session, { role: 'user', content: msg.message }]
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
          ;(self as any).postMessage({ type: 'tool_start', requestId: msg.requestId, tool: tc.function?.name, args: tc.function?.arguments })
          // Worker cannot execute DOM tools directly; ask main thread to execute
          ;(self as any).postMessage({ type: 'tool_request', requestId: msg.requestId, toolCallId: tc.id, tool: tc.function?.name, args: tc.function?.arguments })
          return
        }
      }

      const text = assistant?.content ?? ''
      ;(self as any).postMessage({ type: 'text', requestId: msg.requestId, text })
      ;(self as any).postMessage({ type: 'done', requestId: msg.requestId, fullText: text })
      state.sessions.set(msg.sessionId, [...history, { role: 'assistant', content: text }])
      return
    }
  }
}
