import { useEffect, useRef, useState } from 'react';
import { auth } from '../api/client';
import { useMe } from '../hooks/useMe';

export function UserMenu() {
  const { me, refresh } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onClick);
        document.removeEventListener('keydown', onKey);
      };
    }
  }, [open]);

  const session = auth.getSession();
  if (!session) return null;

  const displayName = me?.full_name ?? `${session.role[0].toUpperCase()}${session.role.slice(1)}`;
  const initials = (me?.full_name ?? session.role)
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('') || 'R';

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => { setOpen((v) => !v); if (!me) void refresh(); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="user-menu-panel"
      >
        <span className="user-avatar" aria-hidden="true">{initials}</span>
        <span className="user-meta">
          <strong>{displayName}</strong>
          <small>{session.role}</small>
        </span>
        <span className="user-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="user-menu-pop" id="user-menu-panel">
          <div className="user-menu-head">
            <strong>{displayName}</strong>
            <span>{me?.email ?? '—'}</span>
            <span>{me?.phone ?? '—'}</span>
          </div>
          {me?.driver && (
            <div className="user-menu-driver">
              <span>Driver profile</span>
              <strong>
                {me.driver.rating_avg !== null
                  ? `${me.driver.rating_avg.toFixed(2)} ★ (${me.driver.rating_count} ratings)`
                  : 'No ratings yet'}
              </strong>
              <small>License {me.driver.license_number ?? '—'}</small>
            </div>
          )}
          <button
            type="button"
            className="user-menu-action"
            onClick={() => { auth.clear(); setOpen(false); }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
