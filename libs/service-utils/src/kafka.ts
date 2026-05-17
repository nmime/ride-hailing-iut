export interface MessageWithValue {
  value?: Buffer | string | null;
}

export interface WarnLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export function parseJsonMessage<T>(
  message: MessageWithValue,
  log?: WarnLogger,
  context: Record<string, unknown> = {},
): T | null {
  if (!message.value) return null;

  try {
    const raw = typeof message.value === 'string' ? message.value : message.value.toString('utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    log?.warn(
      {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      },
      'invalid kafka json message',
    );
    return null;
  }
}
