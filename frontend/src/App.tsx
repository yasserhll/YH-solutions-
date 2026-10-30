import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SiteFilterProvider } from './contexts/SiteFilterContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PwaStatus } from './components/PwaStatus';
import { DashboardLayout } from './layouts/DashboardLayout';
import { hasModule, homePath } from './utils/modules';
import type { ModuleKey } from './types';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PersonnelPage from './pages/PersonnelPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import AttendancePage from './pages/AttendancePage';
import LeavesPage from './pages/LeavesPage';
import SanctionsPage from './pages/SanctionsPage';
import MovementsPage from './pages/MovementsPage';
import AssignmentsPage from './pages/AssignmentsPage';
import OvertimePage from './pages/OvertimePage';
import CashPage from './pages/CashPage';
import ConsommationPage from './pages/ConsommationPage';
import UsersPage from './pages/UsersPage';
import ReportsPage from './pages/ReportsPage';
import HistoriquePage from './pages/HistoriquePage';
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
  if (user?.role !== 'superadmin') return <Navigate to={homePath(user) ?? '/'} replace />;
  return <>{children}</>;
}

/**
 * A session the account wasn't given (user.allowed_modules) sends it back to
 * its own home page instead of a blank/403'd screen. UX only: the backend's
 * `module:<key>` middleware is what actually refuses the data.
 */
function RequireModule({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!hasModule(user, module)) {
    const home = homePath(user);
    return home ? <Navigate to={home} replace /> : <NoModules />;
  }
  return <>{children}</>;
}

function NoModules() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      Aucune session n'est ouverte pour ce compte. Contactez un SuperAdmin pour obtenir un accès.
    </div>
  );
}

/** Managing animateur accounts is a responsable_hse (and SuperAdmin) privilege — an `hse` account never sees it. */
function RequireResponsableHse({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== 'responsable_hse' && user.role !== 'superadmin') return <Navigate to={homePath(user) ?? '/'} replace />;
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
                      <RequireModule module="dashboard">
                        <DashboardPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/pointage"
                    element={
                      <RequireModule module="pointage">
                        <AttendancePage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/conges"
                    element={
                      <RequireModule module="conges">
                        <LeavesPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/sanctions"
                    element={
                      <RequireModule module="sanctions">
                        <SanctionsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/mouvements"
                    element={
                      <RequireModule module="mouvements">
                        <MovementsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/affectations"
                    element={
                      <RequireModule module="affectations">
                        <AssignmentsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/heures-supplementaires"
                    element={
                      <RequireModule module="heures_sup">
                        <OvertimePage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/caisse"
                    element={
                      <RequireModule module="caisse">
                        <CashPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/consommation"
                    element={
                      <RequireModule module="consommation">
                        <ConsommationPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/personnel"
                    element={
                      <RequireModule module="personnel">
                        <PersonnelPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/personnel/:id"
                    element={
                      <RequireModule module="personnel">
                        <EmployeeDetailPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/rapports"
                    element={
                      <RequireModule module="rapports">
                        <ReportsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/historique"
                    element={
                      <RequireModule module="historique">
                        <HistoriquePage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/hse"
                    element={
                      <RequireModule module="hse">
                        <HseDashboardPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/hse/rapports"
                    element={
                      <RequireModule module="hse">
                        <HseReportsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/hse/utilisateurs"
                    element={
                      <RequireModule module="hse">
                        <RequireResponsableHse>
                          <HseUsersPage />
                        </RequireResponsableHse>
                      </RequireModule>
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
