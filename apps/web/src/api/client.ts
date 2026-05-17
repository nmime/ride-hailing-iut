import { normalizeVehicleDraft } from '../domain/vehicle';
const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const INGEST_BASE = import.meta.env.VITE_INGEST_BASE ?? '/ingest';

const TOKEN_KEY = 'ridex_token';
const USER_ID_KEY = 'ridex_user_id';
const ROLE_KEY = 'ridex_role';

export type Role = 'rider' | 'driver' | 'admin';
const ROLES = new Set<Role>(['rider', 'driver', 'admin']);
function isRole(value: string | null): value is Role {
  return value !== null && ROLES.has(value as Role);
}
export interface AuthSession {
  id: string;
  role: Role;
  token: string;
}
export interface NearbyDriver {
  driver_id: string;
  lon: number;
  lat: number;
}

export interface DriverProfile {
  license_number: string | null;
  license_expires_on: string | null;
  status: string | null;
  rating_avg: number | null;
  rating_count: number | null;
}

export interface Me {
  id: string;
  role: Role;
  full_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  driver: DriverProfile | null;
}

export interface Vehicle {
  id: string;
  driver_id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
}

export interface CreateVehicleBody {
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
}

export type UpdateVehicleBody = Partial<CreateVehicleBody> & { is_active?: boolean };

export interface TripSummary {
  id: string;
  status: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  requested_at: string;
  completed_at?: string | null;
  fare_total?: number | string | null;
  currency?: string | null;
  driver_id?: string | null;
  rider_id?: string | null;
}

export interface RateTripBody {
  rating: number;
  comment?: string;
}

export interface DailyDriverReport {
  driver_id: string | null;
  day: string;
  trips: number | string;
  total_km: number | string;
  total_minutes?: number | string;
  gross_revenue: number | string;
}

export interface SurgeZone {
  id: string;
  name: string;
  base_multiplier: number | string;
  polygon_geo?: string | null;
}

export interface CompletedFare {
  id: string;
  distance_km: number | string;
  duration_min: number | string;
  surge_multiplier: number | string;
  total: number | string;
  currency?: string;
}

const listeners = new Set<() => void>();
function notifyAuthChange() {
  listeners.forEach((l) => l());
}

export const auth = {
  setSession(session: AuthSession) {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(USER_ID_KEY, session.id);
    localStorage.setItem(ROLE_KEY, session.role);
    notifyAuthChange();
  },
  getSession(): AuthSession | null {
    const token = localStorage.getItem(TOKEN_KEY);
    const id = localStorage.getItem(USER_ID_KEY);
    const role = localStorage.getItem(ROLE_KEY);
    if (!token || !id || !isRole(role)) return null;
    return { id, role, token };
  },
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(ROLE_KEY);
    notifyAuthChange();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body !== undefined && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  const tok = auth.getToken();
  if (tok) headers['authorization'] = `Bearer ${tok}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let pretty = `${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) pretty = `${res.status} ${parsed.message}`;
      else pretty = `${res.status} ${text}`;
    } catch {
      pretty = `${res.status} ${text}`;
    }
    throw new Error(pretty);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // auth
  signup: (body: {
    role: 'rider' | 'driver';
    full_name: string;
    email: string;
    phone: string;
    password: string;
    license_number?: string;
    license_expires_on?: string;
  }) => req<AuthSession>('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { phone: string; password: string }) =>
    req<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  // profile
  me: () => req<Me>('/me'),

  // vehicles
  vehicles: () => req<Vehicle[]>('/vehicles'),
  createVehicle: (body: CreateVehicleBody) =>
    req<Vehicle>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(normalizeVehicleDraft(body)),
    }),
  updateVehicle: (id: string, body: UpdateVehicleBody) =>
    req<Vehicle>(`/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteVehicle: (id: string) =>
    req<{ id: string; deleted: boolean }>(`/vehicles/${id}`, { method: 'DELETE' }),

  // trips
  createTrip: (body: {
    pickup: { lat: number; lon: number };
    dropoff: { lat: number; lon: number };
    pickup_address?: string;
    dropoff_address?: string;
  }) =>
    req<{ id: string; status: string; requested_at: string }>('/trips', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listTrips: (params: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    const qs = q.toString();
    return req<TripSummary[]>(`/trips${qs ? `?${qs}` : ''}`);
  },
  getTrip: (id: string) => req<TripSummary>(`/trips/${id}`),
  cancelTrip: (id: string) => req<TripSummary>(`/trips/${id}/cancel`, { method: 'POST' }),
  startTrip: (id: string) => req<TripSummary>(`/trips/${id}/start`, { method: 'POST' }),
  completeTrip: (id: string) => req<CompletedFare>(`/trips/${id}/complete`, { method: 'POST' }),
  rateTrip: (id: string, body: RateTripBody) =>
    req<{ trip_id: string; rating: number }>(`/trips/${id}/rating`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // drivers
  setDriverStatus: (id: string, status: 'online' | 'offline' | 'on_trip') =>
    req<{ driverId: string; status: string }>(`/drivers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  nearby: (lon: number, lat: number, radius_m = 2000) =>
    req<NearbyDriver[]>(`/drivers/nearby?lon=${lon}&lat=${lat}&radius_m=${radius_m}`),

  // ingest (driver location)
  sendLocation: (body: {
    driver_id: string;
    lat: number;
    lon: number;
    heading_deg?: number;
    speed_mps?: number;
  }) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const tok = auth.getToken();
    if (tok) headers.authorization = `Bearer ${tok}`;
    return fetch(`${INGEST_BASE}/v1/locations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, ts: Date.now() }),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res.json();
    });
  },

  // admin
  daily: () => req<DailyDriverReport[]>('/admin/reports/daily'),
  surge: () => req<SurgeZone[]>('/admin/surge'),
};
