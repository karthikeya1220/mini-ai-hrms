// =============================================================================
// App.tsx — root component: router + providers + toast container
// =============================================================================

import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthProvider';
import { Web3Provider } from './context/Web3Context';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/routing';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import TaskBoardPage from './pages/TaskBoardPage';
import InsightsPage from './pages/InsightsPage';
import { AdminLayout } from './components/layout/AdminLayout';
import { EmployeeLayout } from './components/layout/EmployeeLayout';
import MyHome from './pages/MyHome';

// ─── GuestRoute ───────────────────────────────────────────────────────────────
// Redirects already-authenticated users away from /login and /register.
function GuestRoute() {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={isAdmin ? '/dashboard' : '/my'} replace />;
  }

  return <Outlet />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function AppRouter() {
  const { isAdmin, isAuthenticated } = useAuth();

  return (
    <Routes>
      {/* Root → landing for guests, dashboard/home for authed users */}
      <Route path="/" element={
        isAuthenticated
          ? <Navigate to={isAdmin ? '/dashboard' : '/my'} replace />
          : <LandingPage />
      } />

      {/* Guest-only — redirect to dashboard if already signed in */}
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Protected — redirect to /login if not signed in */}
      <Route element={<ProtectedRoute />}>

        {/* Admin Routes */}
        <Route element={<AdminLayout />}>
          <Route element={<ProtectedRoute requireAdmin />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/tasks" element={<TaskBoardPage />} />
            <Route path="/insights" element={<InsightsPage />} />
          </Route>
        </Route>

        {/* Employee Routes — /my is for employees; admins are redirected to /dashboard */}
        <Route element={<EmployeeLayout />}>
          <Route element={<ProtectedRoute requireEmployee />}>
            <Route path="/my" element={<MyHome />} />
          </Route>
        </Route>
      </Route>

      {/* 404 fallback */}
      <Route
        path="*"
        element={
          <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
            <p className="text-6xl font-black text-slate-800">404</p>
            <p className="text-slate-400">Page not found.</p>
            <a href="/dashboard" className="btn-ghost">Go to dashboard →</a>
          </div>
        }
      />
    </Routes>
  );
}

// ─── App (root) ───────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/*
          Web3Provider is inside AuthProvider so components can consume
          both useAuth() and useWeb3Context() in the same tree.
          Web3 is completely optional — if MetaMask is absent the app
          behaves identically with all web3 calls being silent no-ops.
        */}
        <Web3Provider>
          <AppRouter />

          {/* Toast notifications */}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1e293b',   // slate-800
                color: '#f1f5f9',   // slate-100
                border: '1px solid #334155',  // slate-700
                borderRadius: '12px',
                fontSize: '14px',
              },
              success: {
                iconTheme: { primary: '#6366f1', secondary: '#fff' },
              },
              error: {
                iconTheme: { primary: '#ef4444', secondary: '#fff' },
              },
            }}
          />
        </Web3Provider>
      </AuthProvider>
    </BrowserRouter>
  );
}
