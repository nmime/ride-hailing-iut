import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { ApiError, api, auth, AuthSession, Role } from '../api/client';
import '../auth-polish.css';

interface AuthGateProps {
  role: Role;
  children: ReactNode;
}

interface DemoMember {
  name: string;
  title: string;
  phone: string;
  avatar: string;
}

const ROLE_CONTEXT: Record<
  Role,
  {
    icon: string;
    eyebrow: string;
    title: string;
    description: string;
    stats: string[];
    members: DemoMember[];
  }
> = {
  rider: {
    icon: '🚕',
    eyebrow: 'Rider workspace',
    title: 'Request, track, and rate a ride in the live demo.',
    description:
      'Use a seeded rider account to exercise matching, map updates, fare estimates, cancellation, and trip history through the real API.',
    stats: ['Live matching', 'Map + coverage', 'Trip history'],
    members: [
      { name: 'Aziza Rider', title: 'Commuter demo', phone: '+998901111111', avatar: 'AR' },
      { name: 'Bekzod Rider', title: 'Airport run', phone: '+998902222222', avatar: 'BR' },
    ],
  },
  driver: {
    icon: '🧭',
    eyebrow: 'Driver cockpit',
    title: 'Manage availability, active trips, and vehicle readiness.',
    description:
      'Seeded drivers include licenses, active vehicles, current locations, and online status so the cockpit opens with meaningful operational state.',
    stats: ['Online toggle', 'Vehicle panel', 'Trip actions'],
    members: [
      { name: 'Davron Driver', title: 'Online · Cobalt', phone: '+998903333333', avatar: 'DD' },
      { name: 'Eldor Driver', title: 'Online · Lacetti', phone: '+998904444444', avatar: 'ED' },
      { name: 'Farhod Driver', title: 'Offline · Spark', phone: '+998905555555', avatar: 'FD' },
    ],
  },
  admin: {
    icon: '📊',
    eyebrow: 'Admin console',
    title: 'Inspect demand, trips, surge zones, and platform health.',
    description:
      'The admin demo account opens read-only operational dashboards backed by database views and live service health checks.',
    stats: ['Daily reports', 'Surge zones', 'Health checks'],
    members: [
      { name: 'Demo Admin', title: 'Operations lead', phone: '+998900000000', avatar: 'DA' },
    ],
  },
};

function labelFor(role: Role) {
  return role[0].toUpperCase() + role.slice(1);
}

function describeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sign-in failed. The demo user may need to be re-seeded; try another demo member or manual credentials.';
    }
    if (error.status === 503) {
      return 'One-click demo login is not enabled on this deployment. Enter the seeded credentials manually.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function AuthGate({ role, children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => auth.getSession());
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<'manual' | 'demo' | null>(null);
  const roleLabel = labelFor(role);
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
    setPassword('');
    setErr(null);
  }, [context.members, role]);

  async function acceptSession(next: AuthSession) {
    if (next.role !== role) {
      auth.clear();
      throw new Error(
        `This account is ${next.role}; open the ${next.role} workspace or choose a ${role} demo member.`,
      );
    }
    auth.setSession(next);
    setSession(next);
  }

  async function submitLogin(nextPhone = phone, nextPassword = password, event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setActiveAction('manual');
    setErr(null);
    try {
      await acceptSession(await api.login({ phone: nextPhone.trim(), password: nextPassword }));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function submitDemoLogin(member = selectedMember) {
    setSelectedPhone(member.phone);
    setPhone(member.phone);
    setLoading(true);
    setActiveAction('demo');
    setErr(null);
    try {
      await acceptSession(await api.demoLogin({ phone: member.phone, expected_role: role }));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  function chooseMember(member: DemoMember) {
    setSelectedPhone(member.phone);
    setPhone(member.phone);
    setErr(null);
  }

  if (session?.role === role) return <>{children}</>;

  return (
    <div className={`auth-layout auth-layout-${role}`}>
      <aside className="auth-context-card" aria-label={`${roleLabel} demo overview`}>
        <div className="auth-brand-row">
          <span className="auth-role-icon" aria-hidden="true">
            {context.icon}
          </span>
          <div>
            <p className="eyebrow">{context.eyebrow}</p>
            <strong>RideX production demo</strong>
          </div>
        </div>
        <h1>{context.title}</h1>
        <p>{context.description}</p>
        <div className="auth-context-stats" aria-label={`${roleLabel} capabilities`}>
          {context.stats.map((stat) => (
            <span key={stat}>{stat}</span>
          ))}
        </div>
        <div className="auth-preview-card">
          <small>Current path</small>
          <strong>/{role}</strong>
          <span>JWT protected · seeded data · no mock auth</span>
        </div>
      </aside>

      <section className="auth-panel" aria-labelledby={`${role}-auth-title`}>
        <div className="auth-panel-head">
          <p className="eyebrow">Choose demo identity</p>
          <h1 id={`${role}-auth-title`}>Open the {roleLabel} workspace</h1>
          <p>
            One-click demo signs in through the backend using allowed seeded accounts. Manual login
            is available for operators with the deployment seed password.
          </p>
        </div>

        {session && session.role !== role && (
          <div className="notice role-switch-notice" role="status">
            <strong>Different role active.</strong>
            <span>You are signed in as {labelFor(session.role)}.</span>
            <button type="button" className="link-button" onClick={() => auth.clear()}>
              Switch user
            </button>
          </div>
        )}

        <div className="demo-member-grid" role="list" aria-label={`${roleLabel} demo users`}>
          {context.members.map((member) => (
            <button
              type="button"
              key={member.phone}
              className={
                member.phone === selectedPhone ? 'demo-member-card selected' : 'demo-member-card'
              }
              onClick={() => chooseMember(member)}
              aria-pressed={member.phone === selectedPhone}
            >
              <span className="demo-member-avatar">{member.avatar}</span>
              <span className="demo-member-copy">
                <strong>{member.name}</strong>
                <span>{member.title}</span>
                <code>{member.phone}</code>
              </span>
            </button>
          ))}
        </div>

        <form className="auth-card" onSubmit={(event) => void submitLogin(phone, password, event)}>
          <div className="credential-strip">
            <span aria-hidden="true">🔐</span>
            <p>
              <strong>Seeded identity:</strong> {selectedMember.name}. Demo passwords are never
              bundled into the browser.
            </p>
          </div>

          {err && (
            <div className="error auth-error" role="alert" aria-live="assertive">
              <strong>Could not sign in.</strong>
              <span>{err}</span>
            </div>
          )}

          <label htmlFor={`${role}-phone`}>
            Phone
            <input
              id={`${role}-phone`}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              inputMode="tel"
              aria-describedby={`${role}-login-help`}
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
              placeholder="Enter seed password for manual login"
              minLength={8}
            />
          </label>

          <p className="auth-help" id={`${role}-login-help`}>
            Use One-click demo for seeded users, or enter phone + password manually if you manage
            the deployment.
          </p>

          <div className="auth-actions">
            <button className="btn primary" type="submit" disabled={loading || password.length < 8}>
              {activeAction === 'manual' ? 'Signing in...' : `Manual ${roleLabel} login`}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={loading}
              aria-busy={activeAction === 'demo'}
              title={`One-click ${roleLabel} demo login`}
              onClick={() => void submitDemoLogin(selectedMember)}
            >
              {activeAction === 'demo' ? 'Opening...' : 'One-click demo'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
