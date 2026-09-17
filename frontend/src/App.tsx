import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SiteFilterProvider } from './contexts/SiteFilterContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PwaStatus } from './components/PwaStatus';
import { DashboardLayout } from './layouts/DashboardLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PersonnelPage from './pages/PersonnelPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import AttendancePage from './pages/AttendancePage';
import LeavesPage from './pages/LeavesPage';
import SanctionsPage from './pages/SanctionsPage';
import MovementsPage from './pages/MovementsPage';
import AssignmentsPage from './pages/AssignmentsPage';
import CashPage from './pages/CashPage';
import UsersPage from './pages/UsersPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import HseReportsPage from './pages/HseReportsPage';
import HseDashboardPage from './pages/HseDashboardPage';
import HseUsersPage from './pages/HseUsersPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400 dark:bg-slate-950">
        Chargement...
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'superadmin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * `hse` and `responsable_hse` are restricted to ONLY the HSE module — every
 * other route redirects them straight to /hse (the backend enforces this the
 * same way via BlockHseModuleRoles, this is just so the UI never shows a
 * blank/403'd page for a route they can't use).
 */
function RequireFullAccess({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && (user.role === 'hse' || user.role === 'responsable_hse')) return <Navigate to="/hse" replace />;
  return <>{children}</>;
}

/**
 * Narrower than RequireFullAccess: blocks only `hse` (animateur), not
 * `responsable_hse` — used on Pointage/Congés/Sanctions/Entrées-Sorties/
 * Affectations, which a responsable_hse also gets for safety oversight
 * (backed server-side by the `hse.block-animateur` middleware). An `hse`
 * account stays confined to strictly the HSE module.
 */
function RequireNotHseAnimateur({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'hse') return <Navigate to="/hse" replace />;
  return <>{children}</>;
}

/** Mirror of RequireFullAccess: /hse itself is off-limits to a plain responsable. */
function RequireHseAccess({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role === 'responsable') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Managing animateur accounts is a responsable_hse (and SuperAdmin) privilege — an `hse` account never sees it. */
function RequireResponsableHse({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== 'responsable_hse' && user.role !== 'superadmin') return <Navigate to="/hse" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SiteFilterProvider>
              <Toaster position="top-right" />
              <PwaStatus />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  element={
                    <RequireAuth>
                      <DashboardLayout />
                    </RequireAuth>
                  }
                >
                  <Route
                    path="/"
                    element={
                      <RequireFullAccess>
                        <DashboardPage />
                      </RequireFullAccess>
                    }
                  />
                  <Route
                    path="/pointage"
                    element={
                      <RequireNotHseAnimateur>
                        <AttendancePage />
                      </RequireNotHseAnimateur>
                    }
                  />
                  <Route
                    path="/conges"
                    element={
                      <RequireNotHseAnimateur>
                        <LeavesPage />
                      </RequireNotHseAnimateur>
                    }
                  />
                  <Route
                    path="/sanctions"
                    element={
                      <RequireNotHseAnimateur>
                        <SanctionsPage />
                      </RequireNotHseAnimateur>
                    }
                  />
                  <Route
                    path="/mouvements"
                    element={
                      <RequireNotHseAnimateur>
                        <MovementsPage />
                      </RequireNotHseAnimateur>
                    }
                  />
                  <Route
                    path="/affectations"
                    element={
                      <RequireNotHseAnimateur>
                        <AssignmentsPage />
                      </RequireNotHseAnimateur>
                    }
                  />
                  <Route
                    path="/caisse"
                    element={
                      <RequireFullAccess>
                        <CashPage />
                      </RequireFullAccess>
                    }
                  />
                  <Route
                    path="/personnel"
                    element={
                      <RequireFullAccess>
                        <PersonnelPage />
                      </RequireFullAccess>
                    }
                  />
                  <Route
                    path="/personnel/:id"
                    element={
                      <RequireFullAccess>
                        <EmployeeDetailPage />
                      </RequireFullAccess>
                    }
                  />
                  <Route
                    path="/rapports"
                    element={
                      <RequireFullAccess>
                        <ReportsPage />
                      </RequireFullAccess>
                    }
                  />
                  <Route
                    path="/hse"
                    element={
                      <RequireHseAccess>
                        <HseDashboardPage />
                      </RequireHseAccess>
                    }
                  />
                  <Route
                    path="/hse/rapports"
                    element={
                      <RequireHseAccess>
                        <HseReportsPage />
                      </RequireHseAccess>
                    }
                  />
                  <Route
                    path="/hse/utilisateurs"
                    element={
                      <RequireHseAccess>
                        <RequireResponsableHse>
                          <HseUsersPage />
                        </RequireResponsableHse>
                      </RequireHseAccess>
                    }
                  />
                  <Route
                    path="/utilisateurs"
                    element={
                      <RequireSuperAdmin>
                        <UsersPage />
                      </RequireSuperAdmin>
                    }
                  />
                  <Route
                    path="/parametres"
                    element={
                      <RequireSuperAdmin>
                        <SettingsPage />
                      </RequireSuperAdmin>
                    }
                  />
                </Route>
              </Routes>
            </SiteFilterProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
