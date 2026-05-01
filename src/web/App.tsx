import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { useOpenClaudeRuntime, type OpenClaudeWebRuntimeConfig } from './runtime.js'

export function OpenClaudeWebApp(props: OpenClaudeWebRuntimeConfig) {
  const runtime = useOpenClaudeRuntime(props)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root />
    </AssistantRuntimeProvider>
  )
}
