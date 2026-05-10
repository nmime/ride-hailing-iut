import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { AuthGate } from '../components/AuthGate';

export default function AdminPage() {
  return (
    <AuthGate role="admin">
      <AdminContent />
    </AuthGate>
  );
}

function AdminContent() {
  const [daily, setDaily] = useState<any[]>([]);
  const [surge, setSurge] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refresh();
  }, []);

  const totals = useMemo(() => daily.reduce(
    (acc, item) => ({
      trips: acc.trips + Number(item.trips ?? 0),
      km: acc.km + Number(item.total_km ?? 0),
      revenue: acc.revenue + Number(item.gross_revenue ?? 0),
    }),
    { trips: 0, km: 0, revenue: 0 },
  ), [daily]);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const [d, s] = await Promise.all([api.daily(), api.surge()]);
      setDaily(d);
      setSurge(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page stack">
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h1>Audit marketplace performance</h1>
          <p>Review surge zones and daily driver performance from authenticated production endpoints.</p>
        </div>
        <button className="btn primary" onClick={refresh} disabled={loading} aria-busy={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {err && <div className="error" role="alert">{err}</div>}

      <section className="metric-grid admin-metrics">
        <div className="card">
          <span>Total trips</span>
          <strong>{totals.trips}</strong>
        </div>
        <div className="card">
          <span>Total km</span>
          <strong>{totals.km.toFixed(1)}</strong>
        </div>
        <div className="card">
          <span>Gross revenue</span>
          <strong>${totals.revenue.toFixed(2)}</strong>
        </div>
        <div className="card">
          <span>Surge zones</span>
          <strong>{surge.length}</strong>
        </div>
      </section>

      <section className="data-grid">
        <div className="card stack">
          <div className="card-heading">
            <h2>Surge zones</h2>
            <span className="pill">{surge.length} zones</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Multiplier</th></tr></thead>
              <tbody>
                {loading && surge.length === 0 ? (
                  <tr><td colSpan={2}>Loading surge zones...</td></tr>
                ) : surge.length === 0 ? (
                  <tr><td colSpan={2}>No surge zones returned.</td></tr>
                ) : surge.map((z) => (
                  <tr key={z.id}><td>{z.name}</td><td>{Number(z.base_multiplier).toFixed(2)}x</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card stack">
          <div className="card-heading">
            <h2>Per-driver daily</h2>
            <span className="pill">{daily.length} rows</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th>Day</th><th className="numeric">Trips</th><th className="numeric">km</th><th className="numeric">Revenue</th></tr></thead>
              <tbody>
                {loading && daily.length === 0 ? (
                  <tr><td colSpan={5}>Loading daily report...</td></tr>
                ) : daily.length === 0 ? (
                  <tr><td colSpan={5}>No daily rows returned.</td></tr>
                ) : daily.map((d, i) => (
                  <tr key={`${d.driver_id}-${d.day}-${i}`}>
                    <td>{String(d.driver_id).slice(0, 8)}</td>
                    <td>{new Date(d.day).toLocaleDateString()}</td>
                    <td className="numeric">{d.trips}</td>
                    <td className="numeric">{Number(d.total_km).toFixed(1)}</td>
                    <td className="numeric">${Number(d.gross_revenue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
