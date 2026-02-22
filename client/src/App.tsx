// =============================================================================
// App.tsx — root component: router + providers + toast container
// =============================================================================

import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthProvider';
import { Web3Provider } from './context/Web3Context';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import TaskBoardPage from './pages/TaskBoardPage';

// ─── ProtectedRoute ───────────────────────────────────────────────────────────
// Wraps any route that requires a valid session.
// While the silent refresh is running (isLoading), renders nothing to avoid
// a flash of the login page. Once resolved, redirects unauthenticated users
// to /login with { state: { from } } so login can redirect them back.

function ProtectedRoute() {
  const { accessToken, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}

// ─── GuestRoute ───────────────────────────────────────────────────────────────
// Redirects already-authenticated users away from /login and /register.

function GuestRoute() {
  const { accessToken, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (accessToken) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function AppRouter() {
  return (
    <Routes>
      {/* Root → dashboard (or login if not authed) */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Guest-only — redirect to dashboard if already signed in */}
      <Route element={<GuestRoute />}>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Protected — redirect to login if not signed in */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/tasks"     element={<TaskBoardPage />} />
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
            position="top-right"
            toastOptions={{
              style: {
                background:   '#1e293b',   // slate-800
                color:        '#f1f5f9',   // slate-100
                border:       '1px solid #334155',  // slate-700
                borderRadius: '12px',
                fontSize:     '14px',
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
