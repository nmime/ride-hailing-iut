import { Injectable, Logger } from '@nestjs/common';

/**
 * Tiny in-process Prometheus exposition.
 *
 * We deliberately do *not* take a dependency on prom-client to keep the
 * surface area small and explainable in viva. Counters, gauges and
 * histograms are tracked in maps keyed by serialised label strings.
 *
 * The set of metrics emitted matches the Grafana dashboard provisioned
 * under `infra/grafana`:
 *
 *   - http_server_request_duration_seconds_bucket{...}
 *   - http_server_request_duration_seconds_count{...}
 *   - http_server_request_duration_seconds_sum{...}
 *   - ridex_trip_events_total{event_type}
 *   - ridex_drivers_online                    (gauge)
 *   - ridex_ratelimit_decisions_total{bucket,outcome}
 */
const HTTP_BUCKETS_S = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramSeries {
  bucketCounts: number[];
  count: number;
  sumS: number;
}

@Injectable()
export class MetricsService {
  private readonly log = new Logger(MetricsService.name);

  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges   = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, HistogramSeries>>();

  // ---------- API ----------

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const m = this.ensureCounter(name);
    const k = serialise(labels);
    m.set(k, (m.get(k) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}) {
    const m = this.ensureGauge(name);
    m.set(serialise(labels), value);
  }

  observeHistogram(name: string, value: number, labels: Record<string, string> = {}) {
    const m = this.ensureHistogram(name);
    const k = serialise(labels);
    let s = m.get(k);
    if (!s) {
      s = { bucketCounts: new Array(HTTP_BUCKETS_S.length).fill(0), count: 0, sumS: 0 };
      m.set(k, s);
    }
    s.count += 1;
    s.sumS += value;
    for (let i = 0; i < HTTP_BUCKETS_S.length; i++) {
      if (value <= HTTP_BUCKETS_S[i]) s.bucketCounts[i] += 1;
    }
  }

  // Domain-specific helpers --------------------------------------------------

  tripEvent(eventType: string) {
    this.inc('ridex_trip_events_total', { event_type: eventType });
  }

  rateLimitDecision(bucket: string, allowed: boolean) {
    this.inc('ridex_ratelimit_decisions_total', {
      bucket,
      outcome: allowed ? 'allowed' : 'denied',
    });
  }

  setDriversOnline(count: number) {
    this.setGauge('ridex_drivers_online', count);
  }

  observeHttp(durationS: number, route: string, method: string, statusCode: number) {
    this.observeHistogram('http_server_request_duration_seconds', durationS, {
      http_route: route,
      http_request_method: method,
      http_response_status_code: String(statusCode),
    });
  }

  /** Render the registry in Prometheus 0.0.4 text format. */
  render(): string {
    const out: string[] = [];

    for (const [name, series] of this.counters) {
      out.push(`# HELP ${name} counter`);
      out.push(`# TYPE ${name} counter`);
      for (const [labels, v] of series) {
        out.push(`${name}${labels} ${v}`);
      }
    }
    for (const [name, series] of this.gauges) {
      out.push(`# HELP ${name} gauge`);
      out.push(`# TYPE ${name} gauge`);
      for (const [labels, v] of series) {
        out.push(`${name}${labels} ${v}`);
      }
    }
    for (const [name, series] of this.histograms) {
      out.push(`# HELP ${name} histogram`);
      out.push(`# TYPE ${name} histogram`);
      for (const [labels, h] of series) {
        for (let i = 0; i < HTTP_BUCKETS_S.length; i++) {
          out.push(`${name}_bucket${withLe(labels, HTTP_BUCKETS_S[i])} ${h.bucketCounts[i]}`);
        }
        out.push(`${name}_bucket${withLe(labels, '+Inf')} ${h.count}`);
        out.push(`${name}_count${labels} ${h.count}`);
        out.push(`${name}_sum${labels} ${h.sumS}`);
      }
    }

    return out.join('\n') + '\n';
  }

  // -------- internals ----------
  private ensureCounter(name: string)   { let m = this.counters.get(name);   if (!m) { m = new Map(); this.counters.set(name, m); }   return m; }
  private ensureGauge(name: string)     { let m = this.gauges.get(name);     if (!m) { m = new Map(); this.gauges.set(name, m); }     return m; }
  private ensureHistogram(name: string) { let m = this.histograms.get(name); if (!m) { m = new Map(); this.histograms.set(name, m); } return m; }
}

function serialise(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabel(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

function withLe(existingLabels: string, le: number | '+Inf'): string {
  const inner = `le="${le}"`;
  if (!existingLabels) return `{${inner}}`;
  // Insert at the end of the existing label-set (before the closing brace).
  return existingLabels.replace(/}$/, `,${inner}}`);
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
