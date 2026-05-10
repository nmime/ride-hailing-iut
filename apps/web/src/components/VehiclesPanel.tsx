import { FormEvent, useEffect, useState } from 'react';
import { api, CreateVehicleBody, Vehicle } from '../api/client';
import { useToast } from '../hooks/useToast';

const EMPTY: CreateVehicleBody = {
  plate: '',
  make: '',
  model: '',
  year: new Date().getFullYear(),
  color: 'White',
  capacity: 4,
};

export function VehiclesPanel() {
  const [list, setList] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<CreateVehicleBody>(EMPTY);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      setList(await api.vehicles());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createVehicle(draft);
      toast(`Vehicle ${draft.plate} added`, 'success');
      setShowForm(false);
      setDraft(EMPTY);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await api.updateVehicle(id, { is_active: true });
      toast('Active vehicle updated', 'success');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, plate: string) {
    if (!confirm(`Remove vehicle ${plate}?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteVehicle(id);
      toast(`Vehicle ${plate} removed`, 'success');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="driver-control-section">
      <div className="card-heading">
        <h2>Vehicles</h2>
        <span className="pill">{list.length} registered</span>
      </div>

      {err && <div className="error" role="alert">{err}</div>}

      {loading ? (
        <p className="muted">Loading vehicles...</p>
      ) : list.length === 0 ? (
        <p className="muted">No vehicles yet. Add one to start accepting trips.</p>
      ) : (
        <div className="vehicle-list">
          {list.map((v) => (
            <div className={v.is_active ? 'vehicle-row active' : 'vehicle-row'} key={v.id}>
              <div>
                <strong>{v.plate}</strong>
                <span>{v.make} {v.model} · {v.year} · {v.color}</span>
                <small>Capacity {v.capacity}</small>
              </div>
              <div className="vehicle-actions">
                {v.is_active ? (
                  <span className="pill success">Active</span>
                ) : (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void setActive(v.id)}
                  >
                    Make active
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void remove(v.id, v.plate)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form className="vehicle-form stack" onSubmit={submit}>
          <div className="grid-2">
            <label>Plate
              <input
                value={draft.plate}
                onChange={(e) => setDraft({ ...draft, plate: e.target.value.toUpperCase() })}
                required
                minLength={3}
                maxLength={16}
              />
            </label>
            <label>Color
              <input
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                required
                maxLength={32}
              />
            </label>
            <label>Make
              <input
                value={draft.make}
                onChange={(e) => setDraft({ ...draft, make: e.target.value })}
                required
                maxLength={64}
              />
            </label>
            <label>Model
              <input
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                required
                maxLength={64}
              />
            </label>
            <label>Year
              <input
                type="number"
                value={draft.year}
                min={1990}
                max={2100}
                onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })}
                required
              />
            </label>
            <label>Capacity
              <input
                type="number"
                value={draft.capacity}
                min={1}
                max={8}
                onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
                required
              />
            </label>
          </div>
          <div className="button-row">
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving...' : 'Add vehicle'}
            </button>
            <button type="button" className="btn ghost" onClick={() => { setShowForm(false); setDraft(EMPTY); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button type="button" className="btn secondary" onClick={() => setShowForm(true)}>
            Add vehicle
          </button>
          <button type="button" className="btn ghost" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
      )}
    </section>
  );
}
