import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import RiderPage  from './pages/Rider';
import DriverPage from './pages/Driver';
import AdminPage  from './pages/Admin';

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h2 style={{ fontSize: 18, marginTop: 0 }}>RideX</h2>
        <NavLink to="/rider"  className={({ isActive }) => isActive ? 'active' : ''}>Rider</NavLink>
        <NavLink to="/driver" className={({ isActive }) => isActive ? 'active' : ''}>Driver</NavLink>
        <NavLink to="/admin"  className={({ isActive }) => isActive ? 'active' : ''}>Admin</NavLink>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/"        element={<Navigate to="/rider" replace />} />
          <Route path="/rider"   element={<RiderPage  />} />
          <Route path="/driver"  element={<DriverPage />} />
          <Route path="/admin"   element={<AdminPage  />} />
        </Routes>
      </main>
    </div>
  );
}
