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

    const tools = (this.config.tools ?? []).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.parameters),
      },
    }))

    const browserMessages = [...session.messages, { role: 'user', content: message }]
    const maxTurns = 8

    for (let turn = 0; turn < maxTurns; turn += 1) {
      const response = await fetch(`${this.config.baseURL ?? 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model ?? 'gpt-4o-mini',
          stream: false,
          messages: browserMessages,
          ...(this.config.systemPrompt && turn === 0
            ? { messages: [{ role: 'system', content: this.config.systemPrompt }, ...browserMessages] }
            : {}),
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        }),
      })

      if (!response.ok) throw new Error(`Browser chat request failed: ${response.status}`)
      const data = await response.json() as any
      const assistant = data.choices?.[0]?.message
      const toolCalls = assistant?.tool_calls ?? []

      if (toolCalls.length > 0) {
        browserMessages.push({ role: 'assistant', content: assistant.content ?? '', tool_calls: toolCalls } as any)

        for (const tc of toolCalls) {
          const toolName = tc.function?.name
          const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
          const tool = (this.config.tools ?? []).find((t) => t.name === toolName)
          if (!tool) continue

          yield { type: 'tool_start', name: tool.name, args, toolUseId: tc.id }
          try {
            const result = await tool.execute(args)
            yield { type: 'tool_result', name: tool.name, toolUseId: tc.id, output: result, isError: false }
            browserMessages.push({ role: 'tool', tool_call_id: tc.id, content: result } as any)
          } catch (error) {
            const output = error instanceof Error ? error.message : String(error)
            yield { type: 'tool_result', name: tool.name, toolUseId: tc.id, output, isError: true }
            browserMessages.push({ role: 'tool', tool_call_id: tc.id, content: output } as any)
          }
        }

        continue
      }

      const fullText = assistant?.content ?? ''
      const tokens = fullText.split(/(\s+)/).filter(Boolean)
      for (const t of tokens) {
        yield { type: 'text', text: t }
      }

      session.messages = [...browserMessages, { role: 'assistant', content: fullText }]
      yield { type: 'done', fullText }
      return
    }

    throw new Error('Browser loop exceeded max turns')
  }

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }
}
