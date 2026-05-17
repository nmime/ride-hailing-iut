export type ShutdownCleanup = (signal: NodeJS.Signals) => Promise<void> | void;

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

export function onShutdown(cleanup: ShutdownCleanup) {
  let closing = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      try {
        await cleanup(signal);
      } finally {
        process.exit(0);
      }
    });
  }
}
