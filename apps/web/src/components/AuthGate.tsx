import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { api, auth, AuthSession, Role } from '../api/client';
import '../auth-polish.css';

interface AuthGateProps {
  role: Role;
  children: ReactNode;
}

interface DemoMember {
  name: string;
  title: string;
  phone: string;
  badge: string;
}

const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD ??
  import.meta.env.VITE_RIDEX_DEMO_PASSWORD ??
  '') as string;

const ROLE_CONTEXT: Record<
  Role,
  {
    icon: string;
    eyebrow: string;
    title: string;
    body: string;
    stats: string[];
    accent: string;
    members: DemoMember[];
  }
> = {
  rider: {
    icon: '🚕',
    eyebrow: 'Rider workspace',
    title: 'Book a ride, watch it move, then rate the trip.',
    body: 'A focused passenger console for coverage checks, route estimates, live websocket updates, cancellation, ratings, and trip history.',
    stats: ['Live matching', 'Map + coverage', 'Trip history'],
    accent: 'Passenger flow',
    members: [
      {
        name: 'Aziza Rider',
        title: 'Primary seeded rider',
        phone: '+998901111111',
        badge: 'Booking',
      },
      {
        name: 'Bekzod Rider',
        title: 'Second seeded rider',
        phone: '+998902222222',
        badge: 'History',
      },
    ],
  },
  driver: {
    icon: '🛞',
    eyebrow: 'Driver cockpit',
    title: 'Go online, broadcast location, and complete rides.',
    body: 'A driver-first cockpit for vehicle selection, availability, five-second location ingest, active trip actions, and live map positioning.',
    stats: ['5s pings', 'Vehicle profile', 'Trip controls'],
    accent: 'Fleet operations',
    members: [
      {
        name: 'Davron Driver',
        title: 'Online seeded driver',
        phone: '+998903333333',
        badge: 'Online',
      },
      {
        name: 'Eldor Driver',
        title: 'Second seeded driver',
        phone: '+998904444444',
        badge: 'Online',
      },
      {
        name: 'Farhod Driver',
        title: 'Standby seeded driver',
        phone: '+998905555555',
        badge: 'Standby',
      },
    ],
  },
  admin: {
    icon: '📊',
    eyebrow: 'Admin operations',
    title: 'Audit marketplace health from trusted endpoints.',
    body: 'A secure control room for surge zones, materialised-view KPIs, daily driver performance, readiness, metrics, and operational reporting.',
    stats: ['Surge zones', 'Daily KPIs', 'Secure reports'],
    accent: 'Control room',
    members: [
      {
        name: 'Demo Admin',
        title: 'Seeded administrator',
        phone: '+998900000000',
        badge: 'Reporting',
      },
    ],
  },
};

export function AuthGate({ role, children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => auth.getSession());
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickLoginPhone, setQuickLoginPhone] = useState<string | null>(null);
  const roleLabel = role[0].toUpperCase() + role.slice(1);
  const context = ROLE_CONTEXT[role];
  const selectedMember = useMemo(
    () => context.members.find((member) => member.phone === selectedPhone) ?? context.members[0],
    [context.members, selectedPhone],
  );

  useEffect(() => auth.subscribe(() => setSession(auth.getSession())), []);

  useEffect(() => {
    const first = context.members[0];
    setSelectedPhone(first.phone);
    setPhone(first.phone);
    if (DEMO_PASSWORD) setPassword(DEMO_PASSWORD);
    setErr(null);
  }, [context.members, role]);

  async function submitLogin(nextPhone = phone, nextPassword = password, event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setQuickLoginPhone(nextPhone);
    setErr(null);
    try {
      const next = await api.login({ phone: nextPhone.trim(), password: nextPassword });
      if (next.role !== role) {
        auth.clear();
        throw new Error(
          `This account is ${next.role}; open the ${next.role} workspace or choose a ${role} demo member.`,
        );
      }
      auth.setSession(next);
      setSession(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setQuickLoginPhone(null);
    }
  }

  function chooseMember(member: DemoMember, shouldLogin = false) {
    setSelectedPhone(member.phone);
    setPhone(member.phone);
    if (DEMO_PASSWORD) setPassword(DEMO_PASSWORD);
    setErr(null);
    if (shouldLogin && DEMO_PASSWORD) void submitLogin(member.phone, DEMO_PASSWORD);
  }

  if (session?.role === role) return <>{children}</>;

  return (
    <div className={`auth-layout auth-layout-${role}`}>
      <section className="auth-context-card" aria-label={`${roleLabel} access context`}>
        <div className="auth-brand-row">
          <span className="auth-role-icon" aria-hidden="true">
            {context.icon}
          </span>
          <div>
            <p className="eyebrow">{context.eyebrow}</p>
            <strong>{context.accent}</strong>
          </div>
        </div>
        <h1>{context.title}</h1>
        <p>{context.body}</p>
        <div className="auth-context-stats">
          {context.stats.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="auth-preview-card" aria-hidden="true">
          <span className="auth-preview-dot" />
          <div>
            <strong>{selectedMember.name}</strong>
            <small>
              {selectedMember.badge} · {selectedMember.phone}
            </small>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-label={`${roleLabel} sign in`}>
        <div className="auth-panel-head">
          <p className="eyebrow">Secure role entry</p>
          <h1>Sign in as {roleLabel}</h1>
          <p className="muted">
            Select an existing seeded member below, or enter your own credentials. Demo entry uses
            the real JWT login endpoint.
          </p>
        </div>

        {session && session.role !== role && (
          <div className="notice role-switch-notice">
            <strong>Different role active.</strong>
            <span>
              Signed in as {session.role}; switch user before opening the {role} workspace.
            </span>
            <button type="button" className="link-btn" onClick={auth.clear}>
              Switch user
            </button>
          </div>
        )}

        <div className="demo-member-grid" aria-label={`${roleLabel} demo members`}>
          {context.members.map((member) => (
            <button
              key={member.phone}
              type="button"
              className={
                member.phone === selectedPhone ? 'demo-member-card selected' : 'demo-member-card'
              }
              onClick={() => chooseMember(member)}
              onDoubleClick={() => chooseMember(member, true)}
              aria-pressed={member.phone === selectedPhone}
            >
              <span className="demo-member-avatar" aria-hidden="true">
                {member.name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <span className="demo-member-copy">
                <strong>{member.name}</strong>
                <small>{member.title}</small>
                <code>{member.phone}</code>
              </span>
              <span className="demo-member-badge">{member.badge}</span>
            </button>
          ))}
        </div>

        <form
          className="card stack auth-card"
          onSubmit={(event) => void submitLogin(phone, password, event)}
        >
          <div className="credential-strip" aria-label="Demo credential summary">
            <span>Demo phone</span>
            <strong>{selectedMember.phone}</strong>
            <span>Password</span>
            <strong>{DEMO_PASSWORD ? DEMO_PASSWORD : 'RIDEX_SEED_PASSWORD'}</strong>
          </div>

          {err && (
            <div className="error" role="alert">
              {err}
            </div>
          )}

          <label htmlFor={`${role}-phone`}>
            Phone
            <input
              id={`${role}-phone`}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              placeholder="+998..."
              inputMode="tel"
              required
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
              placeholder="Demo seed password"
              required
            />
          </label>

          <div className="auth-actions">
            <button className="btn primary" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Signing in...' : `Enter ${roleLabel} workspace`}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={loading || !DEMO_PASSWORD}
              aria-disabled={!DEMO_PASSWORD}
              title={
                DEMO_PASSWORD
                  ? `One-click ${roleLabel} demo login`
                  : 'Password is not exposed in this build; enter it manually.'
              }
              onClick={() => chooseMember(selectedMember, true)}
            >
              {quickLoginPhone === selectedMember.phone ? 'Opening...' : 'One-click demo'}
            </button>
          </div>
          {!DEMO_PASSWORD && (
            <p className="form-hint">
              Demo password is supplied by the deployment as <code>RIDEX_SEED_PASSWORD</code>; enter
              it once to keep the seed secret out of source code.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
