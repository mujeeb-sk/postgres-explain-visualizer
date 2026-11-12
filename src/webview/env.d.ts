/// <reference types="vite/client" />

/** Provided by VS Code inside a webview. It can be called once. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
