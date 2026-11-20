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
import { lazyPage, preloadPages } from './utils/lazyPage';
import LoginPage from './pages/LoginPage';
const BonsPage = lazyPage(() => import('./pages/BonsPage'));
const EntreesCarburantPage = lazyPage(() => import('./pages/EntreesCarburantPage'));
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'));
const PersonnelPage = lazyPage(() => import('./pages/PersonnelPage'));
const EmployeeDetailPage = lazyPage(() => import('./pages/EmployeeDetailPage'));
const AttendancePage = lazyPage(() => import('./pages/AttendancePage'));
const LeavesPage = lazyPage(() => import('./pages/LeavesPage'));
const SanctionsPage = lazyPage(() => import('./pages/SanctionsPage'));
const MovementsPage = lazyPage(() => import('./pages/MovementsPage'));
const ContractsPage = lazyPage(() => import('./pages/ContractsPage'));
const AssignmentsPage = lazyPage(() => import('./pages/AssignmentsPage'));
const OvertimePage = lazyPage(() => import('./pages/OvertimePage'));
const CashPage = lazyPage(() => import('./pages/CashPage'));
const ConsommationPage = lazyPage(() => import('./pages/ConsommationPage'));
const UsersPage = lazyPage(() => import('./pages/UsersPage'));
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'));
const HistoriquePage = lazyPage(() => import('./pages/HistoriquePage'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const HseReportsPage = lazyPage(() => import('./pages/HseReportsPage'));
const HseDashboardPage = lazyPage(() => import('./pages/HseDashboardPage'));
const HseUsersPage = lazyPage(() => import('./pages/HseUsersPage'));
const HseAccidentsPage = lazyPage(() => import('./pages/HseAccidentsPage'));
const MaterielPage = lazyPage(() => import('./pages/MaterielPage'));
const AffectationMaterielPage = lazyPage(() => import('./pages/AffectationMaterielPage'));
const DetailCiternesPage = lazyPage(() => import('./pages/DetailCiternesPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading)
    return (
      // Only when this device has no saved copy of the session yet (first
      // start of this version) and the server can't be reached: the session
      // is kept and retried every 5 s, never sent back to the login page.
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 safe-p text-center text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600 dark:border-t-transparent" />
        <div>Connexion au serveur…</div>
        <div className="max-w-xs text-xs text-slate-400 dark:text-slate-500">Votre session est conservée. Si le réseau est coupé, l’application s’ouvrira dès son retour.</div>
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
function RequireModule({ module, children }: { module: ModuleKey | ModuleKey[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!(Array.isArray(module) ? module : [module]).some((m) => hasModule(user, m))) {
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

// Every page in the background once the app is up: menu clicks stay instant.
preloadPages();

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SiteFilterProvider>
              {/* Below the top bar (and the notch), never over the navigation. */}
              <Toaster position="top-right" containerStyle={{ top: 'calc(4.5rem + env(safe-area-inset-top))' }} />
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
                    path="/contrats"
                    element={
                      <RequireModule module="contrats">
                        <ContractsPage />
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
                    path="/bons"
                    element={
                      <RequireModule module="bons">
                        <BonsPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/entrees-carburant"
                    element={
                      <RequireModule module="entrees_carburant">
                        <EntreesCarburantPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/detail-citernes"
                    element={
                      <RequireModule module={['consommation', 'bons']}>
                        <DetailCiternesPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/materiel"
                    element={
                      <RequireModule module="materiel">
                        <MaterielPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/affectation-materiel"
                    element={
                      <RequireModule module="affectation_materiel">
                        <AffectationMaterielPage />
                      </RequireModule>
                    }
                  />
                  <Route
                    path="/hse/suivi-atit"
                    element={
                      <RequireModule module="suivi_atit">
                        <HseAccidentsPage />
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
