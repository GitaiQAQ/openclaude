import { useMemo, useRef, useState } from 'react'

type Message = { role: 'user' | 'assistant'; text: string }

type ToolRequest = {
  requestId: string
  toolCallId: string
  tool: string
  args: string
}

export default function OpenClaudeExample() {
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [running, setRunning] = useState(false)
  const workerRef = useRef<Worker | null>(null)

  const canSend = useMemo(() => apiKey.trim().length > 0 && prompt.trim().length > 0 && !running, [apiKey, prompt, running])

  const runBrowserTool = async (req: ToolRequest): Promise<{ output: string; isError?: boolean }> => {
    try {
      const parsed = req.args ? JSON.parse(req.args) : {}
      if (req.tool === 'fill_form') {
        const selector = String(parsed.selector ?? '')
        const value = String(parsed.value ?? '')
        const el = document.querySelector(selector) as HTMLInputElement | null
        if (!el) return { output: `selector not found: ${selector}`, isError: true }
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return { output: `filled ${selector}` }
      }
      return { output: `tool not implemented on main thread: ${req.tool}`, isError: true }
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true }
    }
  }

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('./opencopilot.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    return worker
  }

  const send = async () => {
    if (!canSend) return

    const worker = ensureWorker()
    worker.postMessage({
      type: 'init',
      apiKey,
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
      tools: [
        {
          name: 'fill_form',
          description: 'Fill form fields in browser',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['selector', 'value'],
            additionalProperties: false,
          },
        },
      ],
    })

    const userText = prompt.trim()
    setPrompt('')
    const requestId = crypto.randomUUID()
    const sessionId = 'demo-session'
    setMessages((prev) => [...prev, { role: 'user', text: userText }, { role: 'assistant', text: '' }])
    setRunning(true)

    worker.onmessage = async (event) => {
      const data = event.data
      if (data.requestId !== requestId) return
      if (data.type === 'tool_request') {
        const toolResult = await runBrowserTool(data)
        worker.postMessage({ type: 'tool_result', requestId, toolCallId: data.toolCallId, ...toolResult })
        return
      }
      if (data.type === 'text') {
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', text: data.text }
          return copy
        })
      }
      if (data.type === 'done' || data.type === 'error') {
        setRunning(false)
      }
    }

    worker.postMessage({ type: 'chat', requestId, sessionId, message: userText })
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>OpenCopilot Worker Example</h1>
      <p>Worker 中执行 loop，主线程执行浏览器工具（示例 fill_form）。</p>
      <input id="demo-input" placeholder="Tool fill target (#demo-input)" style={{ width: '100%', marginBottom: 12, padding: 8 }} />

      <label>
        OpenAI API Key
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 16, padding: 8 }} />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Try: use fill_form to set #demo-input to hello" style={{ flex: 1, padding: 8 }} />
        <button disabled={!canSend} onClick={send}>{running ? 'Running…' : 'Send'}</button>
      </div>

      <div style={{ marginTop: 20, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <strong>{m.role === 'user' ? 'You' : 'Assistant'}:</strong> {m.text}
          </div>
        ))}
      </div>
    </div>
  )
}
