import type { PluginContext, PluginResult } from './plugin/types.ts'
import { initManager, isBunPtyAvailable, bunPtyLoadError, manager } from './plugin/pty/manager.ts'
import { initPermissions } from './plugin/pty/permissions.ts'
import { ptySpawn } from './plugin/pty/tools/spawn.ts'
import { ptyWrite } from './plugin/pty/tools/write.ts'
import { ptyRead } from './plugin/pty/tools/read.ts'
import { ptyList } from './plugin/pty/tools/list.ts'
import { ptyKill } from './plugin/pty/tools/kill.ts'
import { PTYServer } from './web/server/server.ts'
import open from 'open'

const ptyOpenClientCommand = 'pty-open-background-spy'
const ptyShowServerUrlCommand = 'pty-show-server-url'

export const PTYPlugin = async ({ client, directory }: PluginContext): Promise<PluginResult> => {
  // ── Load-time diagnostics ───────────────────────────────────────────────
  const available = isBunPtyAvailable()
  if (!available) {
    const loadErr = bunPtyLoadError()
    console.error(
      `[opencode-pty] ⚠ Plugin loaded but bun-pty is NOT available.\n` +
        `  PTY tools (pty_spawn, pty_read, pty_write, pty_list, pty_kill) will return errors.\n` +
        `  Load error: ${loadErr}\n` +
        `  Platform: ${process.platform}/${process.arch}\n` +
        `  Runtime: ${typeof Bun !== 'undefined' ? `Bun ${(Bun as any).version}` : 'NOT Bun'}\n` +
        `  cwd: ${process.cwd()}\n` +
        `  directory: ${directory}\n` +
        `  Troubleshooting:\n` +
        `    1. Are you running under Bun? (bun-pty is a Bun-native module)\n` +
        `    2. Was 'bun install' run in the opencode-pty directory?\n` +
        `    3. Is the native addon compiled for ${process.platform}/${process.arch}?\n`
    )
  } else {
    console.log(
      `[opencode-pty] ✓ Plugin loaded. bun-pty available. Platform: ${process.platform}/${process.arch}`
    )
  }

  initPermissions(client, directory)
  initManager(client)
  let ptyServer: PTYServer | undefined

  return {
    'command.execute.before': async (input) => {
      if (input.command !== ptyOpenClientCommand && input.command !== ptyShowServerUrlCommand) {
        return
      }
      if (ptyServer === undefined) {
        ptyServer = await PTYServer.createServer()
      }
      if (input.command === ptyOpenClientCommand) {
        open(ptyServer.server.url.origin)
      } else if (input.command === ptyShowServerUrlCommand) {
        const message = `PTY Sessions Web Interface URL: ${ptyServer.server.url.origin}`
        await client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [
              {
                type: 'text',
                text: message,
              },
            ],
          },
        })
      }
      throw new Error('Command handled by PTY plugin')
    },
    tool: {
      pty_spawn: ptySpawn,
      pty_write: ptyWrite,
      pty_read: ptyRead,
      pty_list: ptyList,
      pty_kill: ptyKill,
    },
    config: async (input) => {
      if (!input.command) {
        input.command = {}
      }
      input.command[ptyOpenClientCommand] = {
        template: `This command will start the PTY Sessions Web Interface in your default browser.`,
        description: 'Open PTY Sessions Web Interface',
      }
      input.command[ptyShowServerUrlCommand] = {
        template: `This command will show the PTY Sessions Web Interface URL.`,
        description: 'Show PTY Sessions Web Interface URL',
      }
    },
    event: async ({ event }) => {
      if (event.type === 'session.deleted') {
        manager.cleanupBySession(event.properties.info.id)
      }
    },
  }
}
