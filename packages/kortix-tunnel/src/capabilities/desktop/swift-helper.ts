import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HELPER_VERSION = 'v2';
const BIN_DIR = join(homedir(), '.kortix-tunnel', 'bin');
const HELPER_PATH = join(BIN_DIR, `desktop-helper-${HELPER_VERSION}`);

const SWIFT_SOURCE = `
import Foundation
import CoreGraphics

struct Request: Decodable {
    let action: String
    let x: Double?
    let y: Double?
    let toX: Double?
    let toY: Double?
    let button: String?
    let clicks: Int?
    let modifiers: [String]?
    let deltaX: Int?
    let deltaY: Int?
    let keys: [String]?
}

struct Response: Encodable {
    let ok: Bool
    let x: Double?
    let y: Double?
    let error: String?
}

func modifierFlags(_ names: [String]) -> CGEventFlags {
    var flags = CGEventFlags()
    for name in names {
        switch name.lowercased() {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        case "fn": flags.insert(.maskSecondaryFn)
        default: break
        }
    }
    return flags
}

let keyMap: [String: UInt16] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51,
    "escape": 53, "esc": 53,
    "up": 126, "down": 125, "left": 123, "right": 124,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4,
    "i": 34, "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31,
    "p": 35, "q": 12, "r": 15, "s": 1, "t": 17, "u": 32, "v": 9,
    "w": 13, "x": 7, "y": 16, "z": 6,
    "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23,
    "6": 22, "7": 26, "8": 28, "9": 25,
    "-": 27, "=": 24, "[": 33, "]": 30, "\\\\": 42, ";": 41,
    "'": 39, ",": 43, ".": 47, "/": 44, "\`": 50,
]

func mouseButton(_ name: String?) -> CGMouseButton {
    switch name?.lowercased() {
    case "right": return .right
    case "middle": return .center
    default: return .left
    }
}

func mouseDownType(_ btn: CGMouseButton) -> CGEventType {
    switch btn {
    case .right: return .rightMouseDown
    case .center: return .otherMouseDown
    default: return .leftMouseDown
    }
}

func mouseUpType(_ btn: CGMouseButton) -> CGEventType {
    switch btn {
    case .right: return .rightMouseUp
    case .center: return .otherMouseUp
    default: return .leftMouseUp
    }
}

func mouseDragType(_ btn: CGMouseButton) -> CGEventType {
    switch btn {
    case .right: return .rightMouseDragged
    case .center: return .otherMouseDragged
    default: return .leftMouseDragged
    }
}

func respond(_ r: Response) {
    let data = try! JSONEncoder().encode(r)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\\n".data(using: .utf8)!)
}

func handleRequest(_ req: Request) {
    switch req.action {
    case "click":
        let point = CGPoint(x: req.x ?? 0, y: req.y ?? 0)
        let btn = mouseButton(req.button)
        let clicks = req.clicks ?? 1
        let mods = modifierFlags(req.modifiers ?? [])

        for i in 0..<clicks {
            if let down = CGEvent(mouseEventSource: nil, mouseType: mouseDownType(btn), mouseCursorPosition: point, mouseButton: btn) {
                down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
                if !mods.isEmpty { down.flags = mods }
                down.post(tap: .cghidEventTap)
            }
            if let up = CGEvent(mouseEventSource: nil, mouseType: mouseUpType(btn), mouseCursorPosition: point, mouseButton: btn) {
                up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
                if !mods.isEmpty { up.flags = mods }
                up.post(tap: .cghidEventTap)
            }
        }
        respond(Response(ok: true, x: nil, y: nil, error: nil))

    case "move":
        let point = CGPoint(x: req.x ?? 0, y: req.y ?? 0)
        if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
            event.post(tap: .cghidEventTap)
        }
        respond(Response(ok: true, x: nil, y: nil, error: nil))

    case "drag":
        let from = CGPoint(x: req.x ?? 0, y: req.y ?? 0)
        let to = CGPoint(x: req.toX ?? 0, y: req.toY ?? 0)
        let btn = mouseButton(req.button)

        if let down = CGEvent(mouseEventSource: nil, mouseType: mouseDownType(btn), mouseCursorPosition: from, mouseButton: btn) {
            down.post(tap: .cghidEventTap)
        }
        usleep(50000)

        let steps = 10
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let mid = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
            if let drag = CGEvent(mouseEventSource: nil, mouseType: mouseDragType(btn), mouseCursorPosition: mid, mouseButton: btn) {
                drag.post(tap: .cghidEventTap)
            }
            usleep(10000)
        }

        if let up = CGEvent(mouseEventSource: nil, mouseType: mouseUpType(btn), mouseCursorPosition: to, mouseButton: btn) {
            up.post(tap: .cghidEventTap)
        }
        respond(Response(ok: true, x: nil, y: nil, error: nil))

    case "scroll":
        let point = CGPoint(x: req.x ?? 0, y: req.y ?? 0)
        if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
            move.post(tap: .cghidEventTap)
        }
        usleep(10000)

        let dy = Int32(req.deltaY ?? 0)
        let dx = Int32(req.deltaX ?? 0)
        if let scroll = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 3, wheel1: dy, wheel2: dx, wheel3: 0) {
            scroll.post(tap: .cghidEventTap)
        }
        respond(Response(ok: true, x: nil, y: nil, error: nil))

    case "key":
        let keys = req.keys ?? []
        var mods: [String] = []
        var mainKeys: [String] = []

        for k in keys {
            let lower = k.lowercased()
            if ["cmd", "command", "shift", "alt", "option", "ctrl", "control", "fn"].contains(lower) {
                mods.append(lower)
            } else {
                mainKeys.append(lower)
            }
        }

        let flags = modifierFlags(mods)

        for key in mainKeys {
            guard let code = keyMap[key] else {
                respond(Response(ok: false, x: nil, y: nil, error: "Unknown key: \\(key)"))
                return
            }
            if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true) {
                if !flags.isEmpty { down.flags = flags }
                down.post(tap: .cghidEventTap)
            }
            if let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
                if !flags.isEmpty { up.flags = flags }
                up.post(tap: .cghidEventTap)
            }
        }
        respond(Response(ok: true, x: nil, y: nil, error: nil))

    case "position":
        let loc = CGEvent(source: nil)!.location
        respond(Response(ok: true, x: Double(loc.x), y: Double(loc.y), error: nil))

    default:
        respond(Response(ok: false, x: nil, y: nil, error: "Unknown action: \\(req.action)"))
    }
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let req = try? JSONDecoder().decode(Request.self, from: input) else {
    respond(Response(ok: false, x: nil, y: nil, error: "Invalid JSON input"))
    exit(1)
}
handleRequest(req)
`;

let compiled = false;

export async function ensureHelper(): Promise<string> {
  if (compiled && existsSync(HELPER_PATH)) return HELPER_PATH;

  if (existsSync(HELPER_PATH)) {
    compiled = true;
    return HELPER_PATH;
  }

  mkdirSync(BIN_DIR, { recursive: true });

  const srcPath = join(BIN_DIR, `desktop-helper-${HELPER_VERSION}.swift`);
  writeFileSync(srcPath, SWIFT_SOURCE);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('swiftc', ['-O', '-o', HELPER_PATH, srcPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        chmodSync(HELPER_PATH, 0o755);
        compiled = true;
        resolve();
      } else {
        reject(new Error(`swiftc failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`swiftc not found: ${err.message}. Install Xcode CLI tools: xcode-select --install`));
    });
  });

  return HELPER_PATH;
}

export interface HelperRequest {
  action: string;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  button?: string;
  clicks?: number;
  modifiers?: string[];
  deltaX?: number;
  deltaY?: number;
  keys?: string[];
}

export interface HelperResponse {
  ok: boolean;
  x?: number;
  y?: number;
  error?: string;
}

export async function execHelper(request: HelperRequest): Promise<HelperResponse> {
  const helperPath = await ensureHelper();

  return new Promise((resolve, reject) => {
    const proc = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (stderr.includes('accessibility') || stderr.includes('kAXError')) {
          reject(new Error(
            'Accessibility permission required. Open System Settings → Privacy & Security → Accessibility → Enable your terminal app.'
          ));
          return;
        }
        reject(new Error(`Helper failed (exit ${code}): ${stderr}`));
        return;
      }

      try {
        const response = JSON.parse(stdout.trim()) as HelperResponse;
        if (!response.ok && response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      } catch {
        reject(new Error(`Invalid helper output: ${stdout}`));
      }
    });

    proc.on('error', reject);

    proc.stdin.write(JSON.stringify(request));
    proc.stdin.end();
  });
}
