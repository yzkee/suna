import { createAgentTriggersPlugin } from "../../triggers/src/index"

export default createAgentTriggersPlugin({
  directory: "/workspace",
  // Trigger state stored in /workspace/.kortix/agent-triggers/triggers.sqlite
  listenerStatePath: "/workspace/.kortix/agent-triggers/listener-state.json",
  webhookHost: "0.0.0.0",
  webhookPort: 8099,
  // publicBaseUrl is used to build webhook URLs for Pipedream.
  // In production, this should be the sandbox's public URL (e.g. via SANDBOX_PUBLIC_URL env).
  // For now, use localhost — events are forwarded via kortix-master.
  publicBaseUrl: process.env.SANDBOX_PUBLIC_URL || "http://localhost:8000",
})
