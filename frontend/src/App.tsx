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
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/pointage" element={<AttendancePage />} />
                  <Route path="/conges" element={<LeavesPage />} />
                  <Route path="/sanctions" element={<SanctionsPage />} />
                  <Route path="/mouvements" element={<MovementsPage />} />
                  <Route path="/affectations" element={<AssignmentsPage />} />
                  <Route path="/caisse" element={<CashPage />} />
                  <Route path="/personnel" element={<PersonnelPage />} />
                  <Route path="/personnel/:id" element={<EmployeeDetailPage />} />
                  <Route path="/rapports" element={<ReportsPage />} />
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
