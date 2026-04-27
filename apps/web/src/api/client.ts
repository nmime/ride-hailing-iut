const BASE = import.meta.env.VITE_API_BASE ?? '/api';

const TOKEN_KEY = 'ridex_token';
export const auth = {
  setToken(t: string) { (window as any).__ridex_token = t; },
  getToken(): string | null { return (window as any).__ridex_token ?? null; },
  clear() { (window as any).__ridex_token = null; },
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  const tok = auth.getToken();
  if (tok) headers['authorization'] = `Bearer ${tok}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  signup: (body: { role: 'rider'|'driver'; full_name: string; email: string; phone: string; password: string }) =>
    req<{ id: string; role: string; token: string }>('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login:  (body: { phone: string; password: string }) =>
    req<{ id: string; role: string; token: string }>('/auth/login',  { method: 'POST', body: JSON.stringify(body) }),

  createTrip: (body: { pickup: { lat: number; lon: number }; dropoff: { lat: number; lon: number } }) =>
    req<{ id: string; status: string; requested_at: string }>('/trips', {
      method: 'POST', body: JSON.stringify(body),
    }),
  getTrip:    (id: string) => req<any>(`/trips/${id}`),
  cancelTrip: (id: string) => req<any>(`/trips/${id}/cancel`, { method: 'POST' }),

  daily:   () => req<any[]>('/admin/reports/daily'),
  surge:   () => req<any[]>('/admin/surge'),
  nearby:  (lon: number, lat: number, radius_m = 2000) =>
    req<any[]>(`/drivers/nearby?lon=${lon}&lat=${lat}&radius_m=${radius_m}`),
};
