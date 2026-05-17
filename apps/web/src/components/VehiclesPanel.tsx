import { FormEvent, useEffect, useState } from 'react';
import { api, CreateVehicleBody, Vehicle } from '../api/client';
import {
  emptyVehicleDraft,
  normalizeVehicleDraft,
  VEHICLE_LIMITS,
  vehicleSummary,
} from '../domain/vehicle';
import { useToast } from '../hooks/useToast';

const TEXT_FIELDS: Array<{
  key: Extract<keyof CreateVehicleBody, 'plate' | 'color' | 'make' | 'model'>;
  label: string;
  minLength?: number;
  maxLength: number;
  normalize?: (value: string) => string;
}> = [
  {
    key: 'plate',
    label: 'Plate',
    minLength: VEHICLE_LIMITS.plate.min,
    maxLength: VEHICLE_LIMITS.plate.max,
    normalize: (value) => value.toUpperCase(),
  },
  { key: 'color', label: 'Color', maxLength: VEHICLE_LIMITS.color.max },
  { key: 'make', label: 'Make', maxLength: VEHICLE_LIMITS.text.max },
  { key: 'model', label: 'Model', maxLength: VEHICLE_LIMITS.text.max },
];

const NUMBER_FIELDS: Array<{
  key: Extract<keyof CreateVehicleBody, 'year' | 'capacity'>;
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'year', label: 'Year', min: VEHICLE_LIMITS.year.min, max: VEHICLE_LIMITS.year.max },
  {
    key: 'capacity',
    label: 'Capacity',
    min: VEHICLE_LIMITS.capacity.min,
    max: VEHICLE_LIMITS.capacity.max,
  },
];

export function VehiclesPanel() {
  const [list, setList] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<CreateVehicleBody>(() => emptyVehicleDraft());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    void refresh();
  }, []);

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

  function patchDraft<K extends keyof CreateVehicleBody>(key: K, value: CreateVehicleBody[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetDraft() {
    setDraft(emptyVehicleDraft());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    const next = normalizeVehicleDraft(draft);
    try {
      await api.createVehicle(next);
      toast(`Vehicle ${next.plate} added`, 'success');
      setShowForm(false);
      resetDraft();
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

      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}

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
                <span>{vehicleSummary(v)}</span>
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
          <p className="muted">
            Your first vehicle becomes active automatically. Additional vehicles are saved inactive
            until you choose “Make active”.
          </p>
          <div className="grid-2">
            {TEXT_FIELDS.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  value={draft[field.key]}
                  onChange={(e) =>
                    patchDraft(field.key, field.normalize?.(e.target.value) ?? e.target.value)
                  }
                  required
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                />
              </label>
            ))}
            {NUMBER_FIELDS.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type="number"
                  value={draft[field.key]}
                  min={field.min}
                  max={field.max}
                  onChange={(e) => patchDraft(field.key, Number(e.target.value))}
                  required
                />
              </label>
            ))}
          </div>
          <div className="button-row">
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Saving...' : 'Add vehicle'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setShowForm(false);
                resetDraft();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button type="button" className="btn secondary" onClick={() => setShowForm(true)}>
            Add vehicle
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      )}
    </section>
  );
}
