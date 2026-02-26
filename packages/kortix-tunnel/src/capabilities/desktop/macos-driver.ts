import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execHelper } from './swift-helper';
import type {
  DesktopDriver,
  ScreenshotOptions,
  ScreenshotResult,
  MouseClickOptions,
  MouseMoveOptions,
  MouseDragOptions,
  MouseScrollOptions,
  MousePosition,
  KeyboardTypeOptions,
  KeyboardKeyOptions,
  WindowInfo,
  WindowBounds,
  AppInfo,
  ScreenInfo,
} from './types';

function tmpPath(ext: string = '.png'): string {
  return join(tmpdir(), `kortix-ss-${randomBytes(6).toString('hex')}${ext}`);
}

function exec(cmd: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) reject(new Error(`${cmd} failed (${code}): ${stderr}`));
      else resolve(stdout);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!killed) reject(err);
    });
  });
}

function osascript(script: string): Promise<string> {
  return exec('osascript', ['-l', 'JavaScript', '-e', script]);
}

async function captureToBase64(args: string[]): Promise<ScreenshotResult> {
  const capturePath = tmpPath('.png');
  const jpegPath = tmpPath('.jpg');

  // Capture as PNG (screencapture native)
  await exec('screencapture', ['-x', '-t', 'png', ...args, capturePath]);

  // Convert to JPEG at 60% quality, downscale to max 1920px (halves Retina)
  await exec('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '60',
    '--resampleHeightWidthMax', '1920',
    capturePath,
    '--out', jpegPath,
  ]);

  // Get dimensions before cleanup
  let width = 0, height = 0;
  try {
    const info = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', jpegPath]);
    const wm = info.match(/pixelWidth:\s*(\d+)/);
    const hm = info.match(/pixelHeight:\s*(\d+)/);
    if (wm) width = parseInt(wm[1], 10);
    if (hm) height = parseInt(hm[1], 10);
  } catch {}

  const buf = await readFile(jpegPath);
  await unlink(capturePath).catch(() => {});
  await unlink(jpegPath).catch(() => {});

  return {
    image: buf.toString('base64'),
    width,
    height,
    format: 'jpeg',
  };
}

export class MacOSDriver implements DesktopDriver {
  async screenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
    const args: string[] = [];

    if (options.region) {
      const { x, y, width, height } = options.region;
      args.push('-R', `${x},${y},${width},${height}`);
    } else if (options.windowId) {
      args.push('-l', String(options.windowId));
    }

    return captureToBase64(args);
  }

  async mouseClick(options: MouseClickOptions): Promise<void> {
    await execHelper({
      action: 'click',
      x: options.x,
      y: options.y,
      button: options.button || 'left',
      clicks: options.clicks || 1,
      modifiers: options.modifiers,
    });
  }

  async mouseMove(options: MouseMoveOptions): Promise<void> {
    await execHelper({ action: 'move', x: options.x, y: options.y });
  }

  async mouseDrag(options: MouseDragOptions): Promise<void> {
    await execHelper({
      action: 'drag',
      x: options.fromX,
      y: options.fromY,
      toX: options.toX,
      toY: options.toY,
      button: options.button || 'left',
    });
  }

  async mouseScroll(options: MouseScrollOptions): Promise<void> {
    await execHelper({
      action: 'scroll',
      x: options.x,
      y: options.y,
      deltaX: options.deltaX || 0,
      deltaY: options.deltaY || 0,
    });
  }

  async mousePosition(): Promise<MousePosition> {
    const res = await execHelper({ action: 'position' });
    return { x: res.x!, y: res.y! };
  }

  async keyboardType(options: KeyboardTypeOptions): Promise<void> {
    const escaped = options.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      const se = Application("System Events");
      se.keystroke("${escaped}");
    `;
    await osascript(script);

    if (options.delay) {
      await new Promise(r => setTimeout(r, options.delay));
    }
  }

  async keyboardKey(options: KeyboardKeyOptions): Promise<void> {
    await execHelper({ action: 'key', keys: options.keys });
  }

  async windowList(): Promise<WindowInfo[]> {
    const script = `
      ObjC.import("CoreGraphics");
      ObjC.import("Foundation");
      const kOnScreen = (1 << 0);
      const kExclDesk = (1 << 4);
      const raw = $.CGWindowListCopyWindowInfo(kOnScreen | kExclDesk, 0);
      const list = ObjC.unwrap(raw);
      const result = [];
      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        const layer = w["kCGWindowLayer"];
        if (layer !== 0) continue;
        const owner = w["kCGWindowOwnerName"] || "";
        const name = w["kCGWindowName"];
        if (name === undefined || name === null) continue;
        const num = w["kCGWindowNumber"];
        const b = w["kCGWindowBounds"];
        result.push({
          id: num,
          app: owner,
          title: name || "",
          bounds: { x: b.X, y: b.Y, width: b.Width, height: b.Height },
          minimized: false,
        });
      }
      JSON.stringify(result);
    `;
    const out = await osascript(script);
    return JSON.parse(out.trim()) as WindowInfo[];
  }

  async windowFocus(windowId: number): Promise<void> {
    const windows = await this.windowList();
    const win = windows.find(w => w.id === windowId);
    if (!win) throw new Error(`Window ${windowId} not found`);

    const script = `
      const app = Application("${win.app}");
      app.activate();
    `;
    await osascript(script);
  }

  async windowResize(windowId: number, bounds: Partial<WindowBounds>): Promise<void> {
    const windows = await this.windowList();
    const win = windows.find(w => w.id === windowId);
    if (!win) throw new Error(`Window ${windowId} not found`);

    const parts: string[] = [];
    if (bounds.x !== undefined || bounds.y !== undefined) {
      const x = bounds.x ?? win.bounds.x;
      const y = bounds.y ?? win.bounds.y;
      parts.push(`w.position = [${x}, ${y}];`);
    }
    if (bounds.width !== undefined || bounds.height !== undefined) {
      const w = bounds.width ?? win.bounds.width;
      const h = bounds.height ?? win.bounds.height;
      parts.push(`w.size = [${w}, ${h}];`);
    }

    if (parts.length === 0) return;

    const title = win.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      const se = Application("System Events");
      const proc = se.processes.byName("${win.app}");
      const wins = proc.windows();
      for (const w of wins) {
        try {
          const pos = w.position();
          if (w.title() === "${title}" && pos[0] === ${win.bounds.x} && pos[1] === ${win.bounds.y}) {
            ${parts.join('\n            ')}
            break;
          }
        } catch(e) {}
      }
    `;
    await osascript(script);
  }

  async windowClose(windowId: number): Promise<void> {
    const windows = await this.windowList();
    const win = windows.find(w => w.id === windowId);
    if (!win) throw new Error(`Window ${windowId} not found`);

    const title = win.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      const se = Application("System Events");
      const proc = se.processes.byName("${win.app}");
      const wins = proc.windows();
      for (const w of wins) {
        try {
          const pos = w.position();
          if (w.title() === "${title}" && pos[0] === ${win.bounds.x} && pos[1] === ${win.bounds.y}) {
            w.buttons.whose({subrole: "AXCloseButton"})()[0].click();
            break;
          }
        } catch(e) {}
      }
    `;
    await osascript(script);
  }

  async windowMinimize(windowId: number): Promise<void> {
    const windows = await this.windowList();
    const win = windows.find(w => w.id === windowId);
    if (!win) throw new Error(`Window ${windowId} not found`);

    const title = win.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      const se = Application("System Events");
      const proc = se.processes.byName("${win.app}");
      const wins = proc.windows();
      for (const w of wins) {
        try {
          const pos = w.position();
          if (w.title() === "${title}" && pos[0] === ${win.bounds.x} && pos[1] === ${win.bounds.y}) {
            w.minimized = true;
            break;
          }
        } catch(e) {}
      }
    `;
    await osascript(script);
  }

  async appLaunch(name: string): Promise<void> {
    await exec('open', ['-a', name]);
  }

  async appQuit(name: string): Promise<void> {
    const script = `
      try {
        const app = Application("${name}");
        app.quit();
        "ok";
      } catch(e) {
        "error: " + e.message;
      }
    `;
    const result = await osascript(script);
    if (result.trim().startsWith('error:')) {
      throw new Error(result.trim());
    }
  }

  async appList(): Promise<AppInfo[]> {
    const script = `
      const se = Application("System Events");
      const procs = se.processes.whose({backgroundOnly: false})();
      const result = [];
      for (const proc of procs) {
        try {
          result.push({
            name: proc.name(),
            pid: proc.unixId(),
            bundleId: proc.bundleIdentifier() || undefined,
          });
        } catch(e) {}
      }
      JSON.stringify(result);
    `;
    const out = await osascript(script);
    return JSON.parse(out.trim()) as AppInfo[];
  }

  async clipboardRead(): Promise<string> {
    return exec('pbpaste', []);
  }

  async clipboardWrite(text: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'pipe'] });
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`pbcopy failed (${code})`));
        else resolve();
      });
      proc.on('error', reject);
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }

  async screenInfo(): Promise<ScreenInfo> {
    const script = `
      ObjC.import("AppKit");
      const screen = $.NSScreen.mainScreen;
      const frame = screen.frame;
      const scale = screen.backingScaleFactor;
      JSON.stringify({
        width: frame.size.width,
        height: frame.size.height,
        scaleFactor: scale,
      });
    `;
    const out = await osascript(script);
    return JSON.parse(out.trim()) as ScreenInfo;
  }

  async cursorImage(radius: number = 50): Promise<ScreenshotResult> {
    const pos = await this.mousePosition();
    const x = Math.max(0, Math.round(pos.x - radius));
    const y = Math.max(0, Math.round(pos.y - radius));
    const size = radius * 2;

    return captureToBase64(['-R', `${x},${y},${size},${size}`]);
  }
}
