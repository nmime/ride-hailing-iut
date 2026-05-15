import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, auth, AuthSession, Role } from '../api/client';

interface AuthGateProps {
  role: Role;
  children: ReactNode;
}

const ROLE_CONTEXT: Record<Role, { eyebrow: string; title: string; body: string; stats: string[] }> = {
  rider: {
    eyebrow: 'Rider workspace',
    title: 'Request, watch, and rate live trips.',
    body: 'Access the booking console, nearby-driver coverage, route links, websocket updates, and trip history.',
    stats: ['Live matching', 'Route estimate', 'Ratings ready'],
  },
  driver: {
    eyebrow: 'Driver cockpit',
    title: 'Broadcast verified location and manage active rides.',
    body: 'Use the driver console for vehicle selection, availability, location ingest, and trip lifecycle actions.',
    stats: ['5s pings', 'Vehicle profile', 'Trip controls'],
  },
  admin: {
    eyebrow: 'Admin operations',
    title: 'Audit the marketplace from trusted endpoints.',
    body: 'Review surge zones, materialised-view KPIs, and daily driver performance with authenticated access.',
    stats: ['Surge zones', 'Daily KPIs', 'Secure reports'],
  },
};

export function AuthGate({ role, children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => auth.getSession());
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const roleLabel = role[0].toUpperCase() + role.slice(1);
  const context = ROLE_CONTEXT[role];

  useEffect(() => auth.subscribe(() => setSession(auth.getSession())), []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const next = await api.login({ phone, password });
      auth.setSession(next);
      setSession(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (session?.role === role) return <>{children}</>;

  return (
    <div className={`auth-layout auth-layout-${role}`}>
      <section className="auth-context-card" aria-label={`${roleLabel} access context`}>
        <p className="eyebrow">{context.eyebrow}</p>
        <h1>{context.title}</h1>
        <p>{context.body}</p>
        <div className="auth-context-stats">
          {context.stats.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <form className="card stack auth-card" onSubmit={login}>
        <div>
          <p className="eyebrow">Secure access</p>
          <h1>Sign in as {roleLabel}</h1>
          <p className="muted">
            Use credentials provisioned by the running environment. Sessions are scoped by role so each workflow stays isolated.
          </p>
        </div>
        {session && session.role !== role && (
          <div className="notice role-switch-notice">
            <strong>Different role active.</strong>
            <span>Signed in as {session.role}; switch user before opening the {role} workspace.</span>
            <button type="button" className="link-btn" onClick={auth.clear}>Switch user</button>
          </div>
        )}
        {err && <div className="error" role="alert">{err}</div>}
        <label htmlFor={`${role}-phone`}>
          Phone
          <input
            id={`${role}-phone`}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            placeholder="+998..."
          />
        </label>
        <label htmlFor={`${role}-password`}>
          Password
          <input
            id={`${role}-password`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Environment password"
          />
        </label>
        <button className="btn primary" type="submit" disabled={loading} aria-busy={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
