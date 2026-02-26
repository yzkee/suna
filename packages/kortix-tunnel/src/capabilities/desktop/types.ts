export interface ScreenshotOptions {
  region?: { x: number; y: number; width: number; height: number };
  windowId?: number;
}

export interface ScreenshotResult {
  image: string;
  width: number;
  height: number;
  format: 'png';
}

export interface MouseClickOptions {
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  clicks?: number;
  modifiers?: string[];
}

export interface MouseMoveOptions {
  x: number;
  y: number;
}

export interface MouseDragOptions {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  button?: 'left' | 'right';
}

export interface MouseScrollOptions {
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
}

export interface MousePosition {
  x: number;
  y: number;
}

export interface KeyboardTypeOptions {
  text: string;
  delay?: number;
}

export interface KeyboardKeyOptions {
  keys: string[];
}

export interface WindowInfo {
  id: number;
  app: string;
  title: string;
  bounds: WindowBounds;
  minimized: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppInfo {
  name: string;
  pid: number;
  bundleId?: string;
}

export interface ScreenInfo {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface DesktopDriver {
  screenshot(options: ScreenshotOptions): Promise<ScreenshotResult>;

  mouseClick(options: MouseClickOptions): Promise<void>;
  mouseMove(options: MouseMoveOptions): Promise<void>;
  mouseDrag(options: MouseDragOptions): Promise<void>;
  mouseScroll(options: MouseScrollOptions): Promise<void>;
  mousePosition(): Promise<MousePosition>;

  keyboardType(options: KeyboardTypeOptions): Promise<void>;
  keyboardKey(options: KeyboardKeyOptions): Promise<void>;

  windowList(): Promise<WindowInfo[]>;
  windowFocus(windowId: number): Promise<void>;
  windowResize(windowId: number, bounds: Partial<WindowBounds>): Promise<void>;
  windowClose(windowId: number): Promise<void>;
  windowMinimize(windowId: number): Promise<void>;

  appLaunch(name: string): Promise<void>;
  appQuit(name: string): Promise<void>;
  appList(): Promise<AppInfo[]>;

  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;

  screenInfo(): Promise<ScreenInfo>;

  cursorImage(radius?: number): Promise<ScreenshotResult>;
}
