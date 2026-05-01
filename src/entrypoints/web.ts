import { z } from 'zod/v4'
import { QueryEngine } from '../QueryEngine.js'
import { WebSearchTool } from '../tools/WebSearchTool/WebSearchTool.js'
import { WebFetchTool } from '../tools/WebFetchTool/WebFetchTool.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import type { AppState } from '../state/AppState.js'
import type { Tool } from '../Tool.js'

export type WebToolDef = {
  name: string
  description: string
  parameters: z.ZodObject<any>
  execute: (args: Record<string, unknown>) => Promise<string>
}

export type OpenClaudeWebConfig = {
  tools?: WebToolDef[]
  webSearch?: boolean
  webFetch?: boolean
  autoApproveTools?: boolean
  systemPrompt?: string
  model?: string
  browserMode?: boolean
  apiKey?: string
  baseURL?: string
}

export type WebChatChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; args: unknown; toolUseId: string }
  | { type: 'tool_result'; name: string; toolUseId: string; output: string; isError: boolean }
  | { type: 'done'; fullText: string }

export class OpenClaudeWeb {
  private config: OpenClaudeWebConfig
  private sessions = new Map<string, { messages: any[] }>()

  constructor(config: OpenClaudeWebConfig = {}) {
    this.config = config
  }

  async *chat(message: string, sessionId?: string): AsyncGenerator<WebChatChunk> {
    if (this.config.browserMode) {
      yield* this.chatBrowser(message, sessionId)
      return
    }

    const session = sessionId
      ? (this.sessions.get(sessionId) ?? { messages: [] })
      : { messages: [] }
    if (sessionId) this.sessions.set(sessionId, session)

    const builtinTools: Tool[] = [
      ...(this.config.webSearch !== false ? [WebSearchTool] : []),
      ...(this.config.webFetch !== false ? [WebFetchTool] : []),
    ]

    const customTools: Tool[] = (this.config.tools ?? []).map(
      (def): Tool => ({
        name: def.name,
        async description() { return def.description },
        async prompt() { return def.description },
        inputSchema: def.parameters,
        isEnabled: () => true,
        isReadOnly: () => false,
        isDestructive: () => false,
        isConcurrencySafe: () => false,
        isOpenWorld: () => false,
        isSearchOrReadCommand: () => false,
        async checkPermissions() {
          return { behavior: 'passthrough' as const, message: '' }
        },
        async call(args: Record<string, unknown>) {
          const result = await def.execute(args)
          return [{ type: 'text' as const, text: result }]
        },
      }),
    )

    let appState: AppState = getDefaultAppState()
    const fileCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)
    const toolNameById = new Map<string, string>()

    const engine = new QueryEngine({
      cwd: '/',
      tools: [...builtinTools, ...customTools],
      commands: [],
      mcpClients: [],
      agents: [],
      readFileCache: fileCache,
      getAppState: () => appState,
      setAppState: (f) => { appState = f(appState) },
      ...(session.messages.length > 0 ? { initialMessages: session.messages } : {}),
      includePartialMessages: true,
      appendSystemPrompt: this.config.systemPrompt,
      userSpecifiedModel: this.config.model,
      fallbackModel: this.config.model,
      canUseTool: async (tool, _input, _ctx, _msg, toolUseID) => {
        if (toolUseID) toolNameById.set(toolUseID, tool.name)
        return { behavior: this.config.autoApproveTools !== false ? 'allow' : 'deny' }
      },
    })

    let fullText = ''

    for await (const msg of engine.submitMessage(message)) {
      if (msg.type === 'stream_event') {
        if (msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
          fullText += msg.event.delta.text
          yield { type: 'text', text: msg.event.delta.text }
        }
      } else if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
        fullText = msg.result
      }
    }

    session.messages = [...engine.getMessages()]
    yield { type: 'done', fullText }
  }

  private async *chatBrowser(message: string, sessionId?: string): AsyncGenerator<WebChatChunk> {
    if (!this.config.apiKey) throw new Error('apiKey is required when browserMode=true')
    const key = sessionId ?? crypto.randomUUID()
    const session = this.sessions.get(key) ?? { messages: [] }
    this.sessions.set(key, session)

    const response = await fetch(`${this.config.baseURL ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model ?? 'gpt-4o-mini',
        stream: true,
        messages: [...session.messages, { role: 'user', content: message }],
      }),
    })
    if (!response.ok || !response.body) throw new Error('Browser chat request failed')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let fullText = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const line = l.trim()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        const d = JSON.parse(payload)
        const text = d.choices?.[0]?.delta?.content
        if (text) {
          fullText += text
          yield { type: 'text', text }
        }
      }
    }
    session.messages.push({ role: 'user', content: message }, { role: 'assistant', content: fullText })
    yield { type: 'done', fullText }
  }

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }
}
