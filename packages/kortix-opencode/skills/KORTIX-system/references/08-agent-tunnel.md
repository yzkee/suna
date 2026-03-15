# Agent Tunnel — Local Machine Control

Interact with the user's local machine: files, shell, screenshots, mouse/keyboard, windows, clipboard, accessibility tree.

---

## Script Location

```bash
TUNNEL=/opt/opencode/skills/agent-tunnel/tunnel.ts
# or:
TUNNEL=~/.opencode/skills/agent-tunnel/tunnel.ts
```

All commands: `bun run "$TUNNEL" <command> '<json-args>'`

---

## Quick Start

```bash
bun run "$TUNNEL" status                                    # Check connection
bun run "$TUNNEL" fs_read '{"path":"/Users/me/file.txt"}'   # Read a file
bun run "$TUNNEL" shell '{"command":"git","args":["status"],"cwd":"/Users/me/project"}'
bun run "$TUNNEL" screenshot                                 # Capture screen
```

---

## Commands

### Connection

| Command | Description |
|---|---|
| `status` | Check tunnel connections, capabilities, machine info |

### Filesystem

| Command | Args | Description |
|---|---|---|
| `fs_read` | `path`, `encoding?` | Read a file |
| `fs_write` | `path`, `content` | Write a file (creates parents) |
| `fs_list` | `path`, `recursive?` | List directory contents |

### Shell

| Command | Args | Description |
|---|---|---|
| `shell` | `command`, `args[]`, `cwd?`, `timeout?` | Execute command (secure, array-based args, default 30s, max 120s) |

### Screen

| Command | Args | Description |
|---|---|---|
| `screenshot` | `x?`, `y?`, `width?`, `height?`, `windowId?` | Capture screen (saves to temp file) |
| `screen_info` | — | Get resolution and scale factor |
| `cursor_image` | `radius?` (default 50px) | Screenshot around cursor |

### Mouse

| Command | Args | Description |
|---|---|---|
| `click` | `x`, `y`, `button?`, `clicks?`, `modifiers?` | Click at coordinates |
| `mouse_move` | `x`, `y` | Move cursor |
| `mouse_drag` | `fromX`, `fromY`, `toX`, `toY`, `button?` | Drag between points |
| `mouse_scroll` | `x`, `y`, `deltaY?`, `deltaX?` | Scroll (positive = down/right) |

### Keyboard

| Command | Args | Description |
|---|---|---|
| `type` | `text`, `delay?` | Type text into focused app |
| `key` | `keys[]` | Press key combo (e.g., `["cmd","s"]`) |

### Windows

| Command | Args | Description |
|---|---|---|
| `window_list` | — | List all windows (IDs, apps, titles, positions) |
| `window_focus` | `windowId` | Bring window to front |
| `app_launch` | `app` | Launch application |
| `app_quit` | `app` | Quit application |

### Clipboard

| Command | Args | Description |
|---|---|---|
| `clipboard_read` | — | Read clipboard |
| `clipboard_write` | `text` | Write to clipboard |

### Accessibility Tree

| Command | Args | Description |
|---|---|---|
| `ax_tree` | `pid?`, `maxDepth?`, `roles?` | Get UI element tree |
| `ax_search` | `query`, `role?`, `pid?`, `maxResults?` | Search elements by label/value |
| `ax_action` | `elementId`, `action`, `pid?` | Perform action (`AXPress`, `AXConfirm`, etc.) |
| `ax_set_value` | `elementId`, `value` | Set element value (reliable for text fields) |
| `ax_focus` | `elementId` | Focus element (more reliable than clicking) |

---

## Decision Tree

```
Check connection?        → status
Read/write local files?  → fs_read / fs_write / fs_list
Run a local command?     → shell
See the screen?          → screenshot / cursor_image / screen_info
Click/drag/scroll?       → click / mouse_move / mouse_drag / mouse_scroll
Type text?               → type
Keyboard shortcut?       → key
Manage windows?          → window_list / window_focus
Launch/quit apps?        → app_launch / app_quit
Clipboard?               → clipboard_read / clipboard_write
Find UI elements?        → ax_tree / ax_search
Interact with UI?        → ax_action / ax_set_value / ax_focus
```

---

## Desktop Automation Workflow

1. **Status:** `status` → verify tunnel online
2. **Orient:** `screenshot` + `window_list` → see what's on screen
3. **Find:** `ax_tree` or `ax_search` → identify UI elements
4. **Interact:** `ax_action`/`ax_set_value` (preferred) or `click`/`type` (fallback)
5. **Verify:** `screenshot` again → confirm action worked

**Prefer accessibility actions** (`ax_*`) over coordinate clicks — more reliable across resolutions.

---

## Error Handling

| Error | Fix |
|---|---|
| No tunnel connection | User needs to create + connect |
| Permission required | Inform user, wait for approval, retry |
| HTTP 404 | Tunnel went offline — ask user to reconnect |
| Timeout | Increase timeout or simplify command |

All commands return JSON with `success: boolean`. Screenshots return `path` to saved image.
