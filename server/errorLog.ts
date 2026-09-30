import { randomUUID } from 'node:crypto';
import type { Collection } from 'mongodb';
import { ERROR_LOG_RETENTION_SECONDS, type ErrorLogDocument } from './database.js';

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 12_000;
const MAX_CONTEXT_ENTRIES = 20;

export async function recordError(
  collection: Collection<ErrorLogDocument>,
  input: {
    source: 'server' | 'client';
    level?: 'error' | 'warning';
    error?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    method?: unknown;
    path?: unknown;
    status?: unknown;
    context?: unknown;
  },
) {
  const errorId = randomUUID();
  const details = errorDetails(input.error);
  const now = new Date();
  await collection.insertOne({
    errorId,
    source: input.source,
    level: input.level || 'error',
    name: limited(input.name || details.name || 'Error', 120),
    message: redact(limited(input.message || details.message || 'Unknown error', MAX_MESSAGE_LENGTH)),
    ...(input.stack || details.stack ? { stack: redact(limited(input.stack || details.stack, MAX_STACK_LENGTH)) } : {}),
    ...(input.method ? { method: limited(input.method, 16).toUpperCase() } : {}),
    ...(input.path ? { path: safePath(input.path) } : {}),
    ...(Number.isInteger(Number(input.status)) ? { status: Number(input.status) } : {}),
    ...(input.context ? { context: safeContext(input.context) } : {}),
    createdAt: now,
    expiresAt: new Date(now.getTime() + ERROR_LOG_RETENTION_SECONDS * 1_000),
  });
  return errorId;
}

export function installConsoleErrorPersistence(collection: Collection<ErrorLogDocument>) {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const persist = (level: 'error' | 'warning', values: unknown[]) => {
    const error = values.find(value => value instanceof Error);
    const message = values.map(printable).join(' ');
    void recordError(collection, { source: 'server', level, error, message, context: { channel: 'console' } })
      .catch(() => undefined);
  };
  console.error = (...values: unknown[]) => { originalError(...values); persist('error', values); };
  console.warn = (...values: unknown[]) => { originalWarn(...values); persist('warning', values); };
}

function errorDetails(value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return { name: 'Error', message: printable(value), stack: '' };
}

function printable(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item); }
  catch { return String(value); }
}

function limited(value: unknown, maximum: number) {
  return String(value ?? '').slice(0, maximum);
}

function safePath(value: unknown) {
  const raw = limited(value, 1_000);
  try { return new URL(raw, 'https://local.invalid').pathname.slice(0, 1_000); }
  catch { return raw.split('?')[0]; }
}

function safeContext(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_CONTEXT_ENTRIES)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    if (/(authorization|cookie|password|secret|token|key)/i.test(key)) result[key] = '[REDACTED]';
    else if (item === null || typeof item === 'number' || typeof item === 'boolean') result[key] = item;
    else if (typeof item === 'string') result[key] = redact(item.slice(0, 500));
  }
  return result;
}

function redact(value: string) {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[-_]?key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@');
}
