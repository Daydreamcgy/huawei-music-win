import type { AppError, Result } from './types';

export function ok<T>(data: T): Result<T> { return { ok: true, data }; }
export function fail<T = never>(error: AppError): Result<T> { return { ok: false, error }; }

export function errorFrom(error: unknown, fallback = '操作未完成'): AppError {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof Error && error.name === 'WriteOutcomeError') {
    const write = error as Error & { kind?: string };
    return { kind: write.kind === 'permission' ? 'permission' : 'unknown', message, retryable: false };
  }
  const lower = message.toLowerCase();
  if (lower.includes('网络') || lower.includes('network') || lower.includes('fetch')) {
    return { kind: 'network', message: '网络请求失败，请检查连接后重试。', retryable: true };
  }
  if (message.includes('需要音乐会话') || message.includes('请先登录华为音乐') || message.includes('音乐会话缺少')) {
    return { kind: 'auth', message, retryable: false };
  }
  return { kind: 'unknown', message, retryable: true };
}
