// Polyfill for Promise.withResolvers (Node.js 21+ feature)
// This is needed for react-pdf compatibility with Node.js 20
if (!Promise.withResolvers) {
  Promise.withResolvers = function <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  } {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: any) => void;
    
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    
    return { promise, resolve: resolve!, reject: reject! };
  };
}

// In some Node dev environments, global localStorage can exist with an invalid shape
// (e.g. getItem is not a function), which crashes SSR in dependencies expecting a
// browser-compatible Storage API.
if (typeof window === 'undefined') {
  const maybeStorage = (globalThis as { localStorage?: unknown }).localStorage as {
    getItem?: unknown;
    setItem?: unknown;
    removeItem?: unknown;
    clear?: unknown;
  } | undefined;

  if (maybeStorage && typeof maybeStorage.getItem !== 'function') {
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
  }
}

// Suppress specific React warnings from third-party libraries (e.g., Syncfusion)
// These warnings are harmless but noisy - they come from libraries using deprecated patterns
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    // Filter out the "selected" on <option> warning from Syncfusion components
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Use the `defaultValue` or `value` props on <select> instead of setting `selected` on <option>')
    ) {
      return; // Suppress this specific warning
    }
    originalError.apply(console, args);
  };
}

export {};
