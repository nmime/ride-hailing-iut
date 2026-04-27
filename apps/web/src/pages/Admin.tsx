import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function AdminPage() {
  const [daily, setDaily] = useState<any[]>([]);
  const [surge, setSurge] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.daily(), api.surge()])
      .then(([d, s]) => { setDaily(d); setSurge(s); })
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div>
      <h1>Admin</h1>
      {err && <div className="card" style={{ background: '#fee2e2' }}>{err}</div>}

      <h3>Surge zones</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Name</th><th align="left">Multiplier</th></tr></thead>
        <tbody>
          {surge.map((z) => (
            <tr key={z.id}><td>{z.name}</td><td>{Number(z.base_multiplier).toFixed(2)}×</td></tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Per-driver daily</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">Driver</th><th align="left">Day</th><th align="right">Trips</th><th align="right">km</th><th align="right">Revenue</th></tr></thead>
        <tbody>
          {daily.map((d, i) => (
            <tr key={i}>
              <td>{String(d.driver_id).slice(0, 8)}…</td>
              <td>{new Date(d.day).toLocaleDateString()}</td>
              <td align="right">{d.trips}</td>
              <td align="right">{Number(d.total_km).toFixed(1)}</td>
              <td align="right">${Number(d.gross_revenue).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
