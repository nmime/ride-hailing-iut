import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { api, auth, AuthSession, Role } from '../api/client';

interface AuthGateProps {
  role: Role;
  children: ReactNode;
}

export function AuthGate({ role, children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => auth.getSession());
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const roleLabel = role[0].toUpperCase() + role.slice(1);

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
    <form className="card stack auth-card" onSubmit={login}>
      <div>
        <p className="eyebrow">Secure access</p>
        <h1>Sign in as {roleLabel}</h1>
        <p className="muted">Use credentials provisioned by the running environment.</p>
      </div>
      {session && session.role !== role && (
        <div className="notice">
          Signed in as {session.role}. <button type="button" className="link-btn" onClick={auth.clear}>Switch user</button>
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
        />
      </label>
      <button className="btn primary" type="submit" disabled={loading} aria-busy={loading}>
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
