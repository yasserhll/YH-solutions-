import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  ShieldAlert,
  ArrowLeftRight,
  Briefcase,
  Wallet,
  Users,
  UserCog,
  FileBarChart,
  Settings,
  PanelLeft,
  LogOut,
  ChevronDown,
  Sun,
  Moon,
  X,
  LifeBuoy,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { useSiteFilter } from '../contexts/SiteFilterContext';
import { useTheme } from '../contexts/ThemeContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Site } from '../types';
import { Brand } from '../components/ui/Brand';

const SUPPORT_EMAIL = 'Hallajiyasser@gmail.com';
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Support - Solution Administrative')}`;

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pointage', label: 'Pointage', icon: Clock },
  { to: '/conges', label: 'Congés', icon: CalendarDays },
  { to: '/sanctions', label: 'Sanctions', icon: ShieldAlert },
  { to: '/mouvements', label: 'Entrées / Sorties', icon: ArrowLeftRight },
  { to: '/affectations', label: 'Affectations', icon: Briefcase },
  { to: '/caisse', label: 'Caisse', icon: Wallet },
  { to: '/personnel', label: 'Personnel', icon: Users },
  { to: '/utilisateurs', label: 'Utilisateurs', icon: UserCog, superadminOnly: true },
  { to: '/rapports', label: 'Rapports', icon: FileBarChart },
  { to: '/parametres', label: 'Paramètres', icon: Settings, superadminOnly: true },
];

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  // Two independent toggles because the sidebar behaves differently per
  // breakpoint: an overlay drawer on mobile (closed by default), a
  // persistent fixed column on desktop (open by default) that can also be
  // closed to reclaim width. Both are flipped together by the one header
  // button — only one of the two ever has visible effect at a given width.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const isSuperAdmin = user?.role === 'superadmin';

  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get<Site[]>('/sites').then((r) => r.data),
    enabled: isSuperAdmin,
  });

  function toggleSidebar() {
    setMobileOpen((o) => !o);
    setDesktopOpen((o) => !o);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Fixed, not part of the document flow — never scrolls with the page. */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white transition-transform duration-200 dark:bg-slate-900',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          desktopOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-5 ">
          <Brand markClassName="h-8" textClassName="text-base" />
          {/* On mobile the drawer sits on top of the topbar's own toggle
              button, so it needs its own close control here — otherwise
              there's no visible way to dismiss it once open. */}
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Fermer le menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems
            .filter((item) => !item.superadminOnly || isSuperAdmin)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
        </nav>

        {/* User identity, theme toggle, and logout live here — not in the
 topbar, which is reserved for the site selector. */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 p-3 ">
          <div className="mb-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 dark:bg-slate-800/60">
            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{user?.name}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500">{isSuperAdmin ? 'SuperAdmin' : 'Responsable de site'}</div>
          </div>
          <a
            href={SUPPORT_MAILTO}
            className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LifeBuoy size={14} />
            Contacter le support
          </a>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Changer de thème"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? 'Clair' : 'Sombre'}
            </button>
            <button
              onClick={() => logout()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut size={14} />
              Déconnexion
            </button>
          </div>
        </div>
      </aside>

      <div className={clsx('flex min-h-screen flex-col transition-[margin] duration-200', desktopOpen ? 'lg:ml-64' : 'lg:ml-0')}>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-white px-4 dark:bg-slate-900 lg:px-6">
          <button
            className="rounded-md p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={toggleSidebar}
            aria-label="Afficher/masquer le menu"
          >
            <PanelLeft size={20} />
          </button>
          {isSuperAdmin ? (
            <SiteSwitcher sites={sites ?? []} />
          ) : (
            <div className="text-sm font-medium text-slate-700 dark:text-slate-300">Site : {user?.site?.name}</div>
          )}
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SiteSwitcher({ sites }: { sites: Site[] }) {
  const { siteId, setSiteId } = useSiteFilter();
  const [open, setOpen] = useState(false);
  const current = sites.find((s) => s.id === siteId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {current ? current.name : 'Tous les sites'}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-48 rounded-lg border border-slate-200 dark:border-slate-800 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <button
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              setSiteId(null);
              setOpen(false);
            }}
          >
            Tous les sites
          </button>
          {sites.map((site) => (
            <button
              key={site.id}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => {
                setSiteId(site.id);
                setOpen(false);
              }}
            >
              {site.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
