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
        if (
          msg.event.type === 'content_block_delta' &&
          msg.event.delta.type === 'text_delta'
        ) {
          fullText += msg.event.delta.text
          yield { type: 'text', text: msg.event.delta.text }
        } else if (
          msg.event.type === 'content_block_start' &&
          msg.event.content_block.type === 'tool_use'
        ) {
          const block = msg.event.content_block
          toolNameById.set(block.id, block.name)
          yield { type: 'tool_start', name: block.name, args: {}, toolUseId: block.id }
        }
      } else if (msg.type === 'user') {
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const output =
                typeof block.content === 'string'
                  ? block.content
                  : (block.content ?? []).map((c: any) => c.text ?? '').join('\n')
              yield {
                type: 'tool_result',
                name: toolNameById.get(block.tool_use_id) ?? block.tool_use_id,
                toolUseId: block.tool_use_id,
                output,
                isError: block.is_error ?? false,
              }
            }
          }
        }
      } else if (msg.type === 'result' && msg.subtype === 'success' && msg.result) {
        fullText = msg.result
      }
    }

    session.messages = [...engine.getMessages()]
    yield { type: 'done', fullText }
  }

  interrupt(_sessionId: string) {}

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }
}
