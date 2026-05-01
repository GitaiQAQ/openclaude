import { useMemo, useState } from 'react'

type Message = { role: 'user' | 'assistant'; text: string }

export default function OpenClaudeExample() {
  const [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [running, setRunning] = useState(false)

  const canSend = useMemo(() => apiKey.trim().length > 0 && prompt.trim().length > 0 && !running, [apiKey, prompt, running])

  const send = async () => {
    if (!canSend) return
    const userText = prompt.trim()
    setPrompt('')
    setMessages((prev) => [...prev, { role: 'user', text: userText }, { role: 'assistant', text: '' }])
    setRunning(true)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        stream: true,
        messages: [{ role: 'user', content: userText }],
      }),
    })

    if (!response.ok || !response.body) {
      const err = await response.text()
      setMessages((prev) => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', text: `Error: ${response.status} ${err}` }
        return copy
      })
      setRunning(false)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          setMessages((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = { role: 'assistant', text: fullText }
            return copy
          })
        }
      }
    }

    setRunning(false)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>OpenClaude Web Example</h1>
      <p>Paste an OpenAI API key, ask a question, and stream tokens in-browser.</p>

      <label>
        OpenAI API Key
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder="sk-..."
          style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 16, padding: 8 }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything..."
          style={{ flex: 1, padding: 8 }}
        />
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
