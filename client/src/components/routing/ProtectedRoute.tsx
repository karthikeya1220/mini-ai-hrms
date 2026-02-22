// =============================================================================
// components/routing/ProtectedRoute.tsx
//
// Route-level auth guard. Renders the matched child route (via <Outlet />) only
// when the user is authenticated.  While the silent refresh is still running
// (isLoading === true) a fullscreen spinner is shown so the user never sees a
// flash of the login page.
//
// Props
//   requireAdmin — when true, also rejects EMPLOYEE users (redirects /dashboard
//                  → /tasks so they land somewhere valid).
//
// NOTE: This is UI enforcement only. Every protected endpoint on the server
// independently validates the JWT and role — never trust the client alone.
// =============================================================================

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// ─── Shared loading spinner ───────────────────────────────────────────────────

function AuthSpinner() {
    return (
        <div className="min-h-dvh flex items-center justify-center bg-slate-950">
            <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
        </div>
    );
}

// ─── ProtectedRoute ───────────────────────────────────────────────────────────

interface ProtectedRouteProps {
    /** When true, only ADMIN users may access the nested routes. */
    requireAdmin?: boolean;
}

export function ProtectedRoute({ requireAdmin = false }: ProtectedRouteProps) {
    const { isAuthenticated, isAdmin, isLoading } = useAuth();
    const location = useLocation();

    // Wait for the silent refresh on mount to resolve before making a decision.
    if (isLoading) return <AuthSpinner />;

    // Not logged in → redirect to /login, preserving intended destination.
    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }

    // Logged in but not an admin when admin is required → kick to /tasks.
    if (requireAdmin && !isAdmin) {
        return <Navigate to="/tasks" replace />;
    }

    return <Outlet />;
}
