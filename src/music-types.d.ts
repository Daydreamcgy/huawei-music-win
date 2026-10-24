declare module '*.mjs' {
  export function createLoginCallback(attempt: any): {
    promise: Promise<string>;
    readonly settled: boolean;
    accept(url: string, now?: number): boolean;
    reject(error: Error): boolean;
  };
  export function loginLoadFailure(callback: { settled: boolean; promise: Promise<string> }, fallback?: string): Promise<string>;
  export function waitForLoginPage(loadPage: () => Promise<unknown>, callback: {
    settled: boolean;
    promise: Promise<string>;
  }): Promise<string | undefined>;
  export function prepareLoginPage(
    configure: () => Promise<unknown>,
    show: () => void,
    load: () => Promise<unknown>,
    callback: { settled: boolean; promise: Promise<string> },
  ): Promise<unknown>;
  export const MUSIC_ENDPOINT: string;
  export const RESEARCH_CLIENT: { clientId: string; redirectUri: string; scopes: string[] };
  export function createAttempt(...args: any[]): any;
  export function isCallback(...args: any[]): boolean;
  export function isAllowedLoginUrl(value: string): boolean;
  export function consumeCallback(...args: any[]): string;
  export function exchangeCode(...args: any[]): Promise<any>;
  export function exchangeMusicSession(...args: any[]): Promise<any>;
  export function readProxySettings(env?: NodeJS.ProcessEnv): { http?: string; https?: string; bypass?: string };
  export function proxyRules(settings: { http?: string; https?: string; bypass?: string }): string | undefined;
  export function electronBypassRules(value?: string): string | undefined;
  export function applyNodeProxy(settings?: { http?: string; https?: string; bypass?: string }): void;
  export class ProviderError extends Error { stage: string; status: number; code: string; subCode: number | null; }
  export class MusicClient {
    constructor(options?: any);
    favorites(options?: any): Promise<any>;
    resolvePlayback(trackId: string, quality?: string): Promise<any>;
  }
}

declare module './safe-media-url.mjs' {
  export function isSafeMediaUrl(value: string): boolean;
}

declare module './main/session-store.cjs' {
  export function persistenceMode(safeStorage: Electron.SafeStorage): 'secure' | 'memory-only';
  export function saveSession(directory: string, session: unknown, safeStorage: Electron.SafeStorage, fs: typeof import('node:fs/promises')): Promise<boolean>;
  export function loadSession(directory: string, safeStorage: Electron.SafeStorage, fs: typeof import('node:fs/promises')): Promise<unknown>;
  export function clearSession(directory: string, fs: typeof import('node:fs/promises')): Promise<void>;
}

declare module './main/session-epoch.mjs' {
  export function createSessionEpoch(): {
    capture(): number;
    advance(): number;
    isCurrent(captured: number): boolean;
  };
}
