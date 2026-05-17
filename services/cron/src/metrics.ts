import { createServer } from 'http';

export class BatchMetrics {
  private runs = 0;
  private failures = 0;

  async safe(name: string, fn: () => Promise<void>, onError: (error: unknown) => void) {
    this.runs += 1;
    try {
      await fn();
    } catch (error) {
      this.failures += 1;
      onError(error);
    }
  }

  renderPrometheus() {
    return (
      `# HELP ridex_batch_runs_total Number of batch jobs attempted\n` +
      `# TYPE ridex_batch_runs_total counter\n` +
      `ridex_batch_runs_total ${this.runs}\n` +
      `# HELP ridex_batch_failures_total Number of batch jobs that errored\n` +
      `# TYPE ridex_batch_failures_total counter\n` +
      `ridex_batch_failures_total ${this.failures}\n`
    );
  }
}

export function startMetricsServer(port: number, metrics: BatchMetrics) {
  return createServer((_, res) => {
    res.setHeader('content-type', 'text/plain; version=0.0.4');
    res.end(metrics.renderPrometheus());
  }).listen(port);
}
