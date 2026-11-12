// The admin panel's frame (v1.13.0): tabs over every admin page. Only platform
// admins see it; for anyone else it's a plain "not found".

import { NavLink, Outlet } from 'react-router-dom';
import { Activity, AlertOctagon, Blocks, LayoutDashboard, Radio, Server } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { ADMIN } from './adminUi';

const TABS = [
  { to: ADMIN, label: 'Overview', icon: LayoutDashboard, end: true },
  { to: `${ADMIN}/errors`, label: 'Errors', icon: AlertOctagon },
  { to: `${ADMIN}/servers`, label: 'Servers', icon: Server },
  { to: `${ADMIN}/activity`, label: 'Activity', icon: Activity },
  { to: `${ADMIN}/modules`, label: 'Modules', icon: Blocks },
  { to: `${ADMIN}/feed`, label: 'Discord feed', icon: Radio },
];

export function AdminLayout() {
  const { isPlatformAdmin, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isPlatformAdmin) return <p className="p-6 text-muted-foreground">Page not found.</p>;
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-condensed text-2xl font-bold uppercase tracking-widest text-white">Admin</h1>
          <p className="text-sm text-muted-foreground">Errors, servers and settings across every server ASOP runs on.</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Admin sections">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cn('flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
