import { useMemo, useRef, useState } from 'react'

type Message = { role: 'user' | 'assistant'; text: string }

export default function OpenClaudeExample() {
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [running, setRunning] = useState(false)
  const workerRef = useRef<Worker | null>(null)

  const canSend = useMemo(() => apiKey.trim().length > 0 && prompt.trim().length > 0 && !running, [apiKey, prompt, running])

  const ensureWorker = () => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('./opencopilot.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    return worker
  }

  const send = async () => {
    if (!canSend) return

    const worker = ensureWorker()
    worker.postMessage({ type: 'init', apiKey, model: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' })

    const userText = prompt.trim()
    setPrompt('')
    const requestId = crypto.randomUUID()
    const sessionId = 'demo-session'
    setMessages((prev) => [...prev, { role: 'user', text: userText }, { role: 'assistant', text: '' }])
    setRunning(true)

    worker.onmessage = (event) => {
      const data = event.data
      if (data.requestId !== requestId) return
      if (data.type === 'text') {
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', text: data.text }
          return copy
        })
      }
      if (data.type === 'done') {
        setRunning(false)
      }
    }

    worker.postMessage({ type: 'chat', requestId, sessionId, message: userText })
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>OpenCopilot Worker Example</h1>
      <p>Worker 中执行 loop，主线程只渲染 UI。</p>

      <label>
        OpenAI API Key
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="sk-..." style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 16, padding: 8 }} />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask anything..." style={{ flex: 1, padding: 8 }} />
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
