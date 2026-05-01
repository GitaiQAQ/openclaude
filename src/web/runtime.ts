import { useState, useCallback, useRef } from 'react'
import { useExternalStoreRuntime } from '@assistant-ui/react'
import type { ThreadMessage, AppendMessage } from '@assistant-ui/react'
import type { WebChatChunk } from '../entrypoints/web.js'

export type OpenClaudeWebRuntimeConfig = {
  chat: (message: string, sessionId: string) => AsyncGenerator<WebChatChunk>
}

function toThreadMessage(role: 'user' | 'assistant', text: string): ThreadMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content: [{ type: 'text', text }],
    createdAt: new Date(),
    status: role === 'assistant' ? { type: 'complete', reason: 'stop' } : undefined,
  } as ThreadMessage
}

export function useOpenClaudeRuntime(config: OpenClaudeWebRuntimeConfig) {
  const sessionId = useRef(crypto.randomUUID())
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const onNew = useCallback(async (msg: AppendMessage) => {
    const userText = msg.content.find((c) => c.type === 'text')?.text ?? ''

    setMessages((prev) => [...prev, toThreadMessage('user', userText)])
    setIsRunning(true)

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        createdAt: new Date(),
        status: { type: 'running' },
      } as ThreadMessage,
    ])

    let accumulated = ''
    for await (const chunk of config.chat(userText, sessionId.current)) {
      if (chunk.type === 'text') {
        accumulated += chunk.text
      }
      if (chunk.type === 'done') {
        accumulated = chunk.fullText
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: [{ type: 'text', text: accumulated }] } : m,
        ),
      )
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, status: { type: 'complete', reason: 'stop' } } : m,
      ),
    )
    setIsRunning(false)
  }, [config])

  return useExternalStoreRuntime({ isRunning, messages, onNew })
}
