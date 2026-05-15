import { Link } from 'react-router-dom';

const productPillars = [
  {
    kicker: 'Rider',
    title: 'Rider requests',
    body: 'Create trips against the live API, follow websocket lifecycle events, inspect nearby drivers, and rate completed rides.',
    stat: 'Trips + ratings',
  },
  {
    kicker: 'Driver',
    title: 'Driver telemetry',
    body: 'Manage vehicles, go online, publish stable location pings through ingest, and progress assigned trips start-to-finish.',
    stat: '5s live pings',
  },
  {
    kicker: 'Admin',
    title: 'Operations reporting',
    body: 'Review surge configuration, daily driver KPIs, materialised-view reports, readiness, metrics, and traceable failures.',
    stat: 'R12 ready',
  },
];

const systemFlow = [
  'Auth',
  'Request',
  'Match',
  'Ingest',
  'Report',
];

const platformStats = [
  { label: 'API replicas', value: '2x', tone: 'primary' },
  { label: 'Stores', value: 'PG + Redis + Redpanda', tone: 'accent' },
  { label: 'Tests', value: '36 checks', tone: 'violet' },
];

const journeySteps = [
  ['01', 'Authenticate', 'Seeded demo users sign in through the real JWT API.'],
  ['02', 'Request', 'Rider creates a trip with WGS-84 pickup/dropoff.'],
  ['03', 'Match', 'Matcher consumes Redpanda events and uses Redis GEO.'],
  ['04', 'Operate', 'Driver starts/completes, rider rates, admin audits.'],
];

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="hero">
        <div className="hero-map" aria-label="RideX dispatch coverage map">
          <div className="map-lattice" aria-hidden="true" />
          <span className="route-line route-line-a" aria-hidden="true" />
          <span className="route-line route-line-b" aria-hidden="true" />
          <span className="route-line route-line-c" aria-hidden="true" />
          <span className="map-node node-rider" aria-hidden="true" />
          <span className="map-node node-driver" aria-hidden="true" />
          <span className="map-node node-zone" aria-hidden="true" />
          <div className="dispatch-strip" aria-hidden="true">
            {systemFlow.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>

        <div className="hero-content">
          <p className="eyebrow">Production ride-hailing workspace</p>
          <h1>Dispatch, drive, and audit from one polished console.</h1>
          <p className="hero-copy">
            RideX is a complete role-based frontend wired to live auth, matching, location ingest, trip events, surge, ratings, Prometheus metrics, and deep readiness checks.
          </p>
          <div className="hero-actions">
            <Link className="btn primary" to="/rider">Request ride</Link>
            <Link className="btn secondary" to="/driver">Open driver cockpit</Link>
            <Link className="btn ghost" to="/admin">Audit operations</Link>
          </div>
          <div className="hero-stat-row" aria-label="Platform status summary">
            {platformStats.map((item) => (
              <div className={`hero-stat hero-stat-${item.tone}`} key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <aside className="hero-status hero-dashboard" aria-label="Live operations dashboard preview">
          <div className="dashboard-head">
            <span>Marketplace pulse</span>
            <strong>Live system</strong>
          </div>
          <div className="dashboard-grid">
            <div><span>Health</span><strong>Ready</strong></div>
            <div><span>Events</span><strong>Streaming</strong></div>
            <div><span>Rate limit</span><strong>On</strong></div>
            <div><span>Maps</span><strong>Fast</strong></div>
          </div>
          <p>No mock data is used in the role screens; every workflow calls the running services through the gateway.</p>
        </aside>
      </section>

      <section className="landing-section">
        <div className="section-heading">
          <p className="eyebrow">Operational surface</p>
          <h2>One adaptive frontend for every role</h2>
        </div>
        <div className="pillar-grid">
          {productPillars.map((pillar) => (
            <article className="card pillar-card" key={pillar.title}>
              <span className="pillar-kicker">{pillar.kicker}</span>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
              <strong>{pillar.stat}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="section-heading">
          <p className="eyebrow">End-to-end journey</p>
          <h2>The frontend covers the complete ride lifecycle.</h2>
        </div>
        <div className="journey-grid">
          {journeySteps.map(([step, title, body]) => (
            <article className="journey-card" key={step}>
              <span>{step}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-band">
        <div>
          <p className="eyebrow">Ready paths</p>
          <h2>Go straight to the workflow you need.</h2>
        </div>
        <div className="role-actions" aria-label="Role entry points">
          <Link className="role-link" to="/rider">
            <span>Rider</span>
            <strong>Book and watch events</strong>
          </Link>
          <Link className="role-link" to="/driver">
            <span>Driver</span>
            <strong>Publish live location</strong>
          </Link>
          <Link className="role-link" to="/admin">
            <span>Admin</span>
            <strong>Audit reporting</strong>
          </Link>
        </div>
      </section>
    </div>
  );
}
