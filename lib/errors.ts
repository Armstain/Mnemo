import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// A short local log of what went wrong, for a bug report the person
// chooses to send (Settings → "Copy problem report"). Nothing is sent
// anywhere by itself. Only error messages are kept, never note content
// on purpose, and each is cut short.

const KEY = 'mnemo-error-log';
const MAX = 30;

export interface LoggedError {
  at: number;
  where: string;
  message: string;
  stack?: string;
}

let queue: Promise<void> = Promise.resolve();

export function logError(where: string, error: unknown): void {
  const e = error as { message?: string; stack?: string };
  const entry: LoggedError = {
    at: Date.now(),
    where,
    message: String(e?.message ?? error).slice(0, 300),
    stack: e?.stack?.split('\n').slice(0, 6).join('\n').slice(0, 800),
  };
  queue = queue.then(async () => {
    try {
      const log = await readErrors();
      await AsyncStorage.setItem(KEY, JSON.stringify([...log, entry].slice(-MAX)));
    } catch {
      // Logging must never be the next problem.
    }
  });
}

export async function readErrors(): Promise<LoggedError[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LoggedError[]) : [];
  } catch {
    return [];
  }
}

export async function clearErrors(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** The report a person can paste into an email or issue: versions and recent errors. */
export async function problemReport(): Promise<string> {
  const errors = await readErrors();
  const lines = [
    `Mnemo ${Constants.expoConfig?.version ?? '?'} · ${Platform.OS} ${String(Platform.Version)}`,
    `Errors logged: ${errors.length}`,
    ...errors
      .slice(-10)
      .reverse()
      .map((e) => `\n[${new Date(e.at).toISOString()}] ${e.where}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`),
  ];
  return lines.join('\n');
}

/**
 * Logs uncaught JS errors too (then lets the usual handler run), and the
 * app's own console.error reports ("Failed to persist…"), which otherwise
 * vanish on a phone.
 */
export function installGlobalErrorLog(): void {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (!__DEV__) {
      const where = typeof args[0] === 'string' ? args[0].slice(0, 80) : 'console';
      logError(where, args.find((a) => a instanceof Error) ?? args.map(String).join(' '));
    }
    originalError(...args);
  };
  const g = globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  if (!g.ErrorUtils) return;
  const previous = g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((error, fatal) => {
    logError(fatal ? 'fatal' : 'uncaught', error);
    previous(error, fatal);
  });
}
