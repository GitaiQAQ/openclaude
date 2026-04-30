import {
  AssistantRuntimeProvider,
  Thread,
} from '@assistant-ui/react'
import { useOpenClaudeRuntime } from './runtime.js'
import type { OpenClaudeWebConfig } from '../entrypoints/web.js'

export function OpenClaudeWebApp(props: OpenClaudeWebConfig) {
  const runtime = useOpenClaudeRuntime(props)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}
