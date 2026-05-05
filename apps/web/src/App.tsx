import { Link, NavLink, Route, Routes } from 'react-router-dom';
import RiderPage  from './pages/Rider';
import DriverPage from './pages/Driver';
import AdminPage  from './pages/Admin';
import LandingPage from './pages/Landing';
import { ToastProvider } from './hooks/useToast';
import { UserMenu } from './components/UserMenu';

const navigation = [
  { to: '/', label: 'Home', end: true },
  { to: '/rider', label: 'Rider' },
  { to: '/driver', label: 'Driver' },
  { to: '/admin', label: 'Admin' },
];

function NotFoundPage() {
  return (
    <div className="page stack">
      <section className="not-found-card">
        <p className="eyebrow">Route not found</p>
        <h1>That RideX screen does not exist.</h1>
        <p>Go back to the landing page, or jump straight into a role workflow.</p>
        <div className="button-row">
          <Link className="btn primary" to="/">Back home</Link>
          <Link className="btn secondary" to="/rider">Rider</Link>
          <Link className="btn secondary" to="/driver">Driver</Link>
          <Link className="btn secondary" to="/admin">Admin</Link>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="RideX home">
            <span className="brand-mark" aria-hidden="true">R</span>
            <span>
              <strong>RideX</strong>
              <small>Live ride operations</small>
            </span>
          </Link>
          <nav className="topnav" aria-label="Primary navigation">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <UserMenu />
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/"        element={<LandingPage />} />
            <Route path="/rider"   element={<RiderPage  />} />
            <Route path="/driver"  element={<DriverPage />} />
            <Route path="/admin"   element={<AdminPage  />} />
            <Route path="*"        element={<NotFoundPage />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <span>RideX · Database Application & Design · Spring 2026</span>
          <a href="/api/docs" target="_blank" rel="noreferrer">API docs</a>
          <a href="/api/metrics" target="_blank" rel="noreferrer">Metrics</a>
        </footer>
      </div>
    </ToastProvider>
  );
}
