import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), invalidateSize: vi.fn(), getContainer: () => document.createElement('div') }),
}));

vi.mock('leaflet', () => ({
  default: { divIcon: (opts: unknown) => opts },
  divIcon: (opts: unknown) => opts,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    emit: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

import App from './App';
import { api, auth, AuthSession } from './api/client';

function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
  });
}

function renderRoute(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('RideX web app shell', () => {
  let consoleError: typeof console.error;

  beforeEach(() => {
    installLocalStorage();
    consoleError = console.error;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (String(message).includes('useLayoutEffect does nothing on the server')) return;
      consoleError(message, ...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the production landing page with role entry points', () => {
    const html = renderRoute('/');

    expect(html).toContain('Production ride-hailing workspace');
    expect(html).toContain('Request ride');
    expect(html).toContain('Open driver cockpit');
    expect(html).toContain('Marketplace pulse');
    expect(html).toContain('The frontend covers the complete ride lifecycle.');
    expect(html).toContain('Audit reporting');
  });

  it('renders a useful not-found route', () => {
    const html = renderRoute('/does-not-exist');

    expect(html).toContain('Route not found');
    expect(html).toContain('Back home');
    expect(html).toContain('Admin');
  });

  it('protects role routes with the correct role-specific sign-in form', () => {
    const html = renderRoute('/rider');

    expect(html).toContain('Sign in as Rider');
    expect(html).toContain('Use credentials provisioned by the running environment');
    expect(html).not.toContain('+998901111111');
    expect(html).not.toContain('Demo credentials are prefilled');
  });

  it('renders rider map tools when a rider session exists', () => {
    auth.setSession({ id: 'rider-1', role: 'rider', token: 'jwt-token' });

    const html = renderRoute('/rider');

    expect(html).toContain('Yandex cards');
    expect(html).toContain('Yandex route');
    expect(html).toContain('Check coverage');
  });
});

describe('RideX web API client', () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('logs in through the real auth endpoint contract and stores the session', async () => {
    const session: AuthSession = { id: 'rider-1', role: 'rider', token: 'jwt-token' };
    const fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(
      async () => jsonResponse(session),
    );
    vi.stubGlobal('fetch', fetchMock);

    const next = await api.login({ phone: '+998901111111', password: 'ChangeMe123!' });
    auth.setSession(next);

    expect(next).toEqual(session);
    expect(auth.getSession()).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ phone: '+998901111111', password: 'ChangeMe123!' }),
    }));
  });

  it('sends authenticated trip requests to the backend without local mock data', async () => {
    auth.setSession({ id: 'rider-1', role: 'rider', token: 'jwt-token' });
    const fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(
      async () => jsonResponse({
        id: 'trip-1',
        status: 'requested',
        requested_at: '2026-04-28T10:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.createTrip({
      pickup: { lat: 41.311, lon: 69.279 },
      dropoff: { lat: 41.33, lon: 69.25 },
      pickup_address: 'Amir Temur Square',
      dropoff_address: 'Inha University in Tashkent',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/trips', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer jwt-token',
        'content-type': 'application/json',
      }),
    }));
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      pickup: { lat: 41.311, lon: 69.279 },
      dropoff: { lat: 41.33, lon: 69.25 },
      pickup_address: 'Amir Temur Square',
      dropoff_address: 'Inha University in Tashkent',
    });
  });

  it('does not send a JSON content-type for bodyless trip actions', async () => {
    auth.setSession({ id: 'rider-1', role: 'rider', token: 'jwt-token' });
    const fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(
      async () => jsonResponse({ id: 'trip-1', status: 'cancelled' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.cancelTrip('trip-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/trips/trip-1/cancel', expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: 'Bearer jwt-token',
      },
    }));
  });

  it('submits ratings to the new /trips/:id/rating endpoint', async () => {
    auth.setSession({ id: 'rider-1', role: 'rider', token: 'jwt-token' });
    const fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(
      async () => jsonResponse({ trip_id: 'trip-1', rating: 5 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.rateTrip('trip-1', { rating: 5, comment: 'Great' });

    expect(result).toEqual({ trip_id: 'trip-1', rating: 5 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ rating: 5, comment: 'Great' });
  });

  it('lists vehicles for the authenticated driver', async () => {
    auth.setSession({ id: 'driver-1', role: 'driver', token: 'jwt-token' });
    const fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(
      async () => jsonResponse([
        { id: 'v-1', driver_id: 'driver-1', plate: '01A123BC', make: 'Chevrolet',
          model: 'Cobalt', year: 2022, color: 'White', capacity: 4, is_active: true,
          created_at: '2026-01-01T00:00:00Z' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const list = await api.vehicles();
    expect(list).toHaveLength(1);
    expect(list[0].plate).toBe('01A123BC');
    expect(fetchMock).toHaveBeenCalledWith('/api/vehicles', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer jwt-token' }),
    }));
  });
});
