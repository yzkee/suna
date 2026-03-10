import { createAgentTriggersPlugin } from "@kortix/opencode-agent-triggers"

export default createAgentTriggersPlugin({
  directory: "/workspace",
  cronStatePath: "/workspace/.local/share/opencode/storage/agent-triggers/cron-state.json",
  webhookHost: "0.0.0.0",
  webhookPort: 8099,
  publicBaseUrl: "http://localhost:8099",
})
