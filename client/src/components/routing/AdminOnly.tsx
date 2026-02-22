// =============================================================================
// components/routing/AdminOnly.tsx
//
// Wrapper component that conditionally renders its children based on the
// current user's role.  Use this for UI elements that should only be visible
// to ADMIN users (e.g. "Add Employee" buttons, admin-only menu items).
//
// Usage:
//   <AdminOnly>
//     <button onClick={openAddModal}>Add employee</button>
//   </AdminOnly>
//
// NOTE: This is purely a presentational guard — it prevents the DOM node from
// rendering but does NOT prevent a determined user from calling the API
// directly.  All admin-only API endpoints enforce role on the server.
// =============================================================================

import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';

interface AdminOnlyProps {
    children: ReactNode;
    /**
     * Optional fallback to render when the user is not an admin.
     * Defaults to null (renders nothing).
     */
    fallback?: ReactNode;
}

export function AdminOnly({ children, fallback = null }: AdminOnlyProps) {
    const { isAdmin } = useAuth();
    return isAdmin ? <>{children}</> : <>{fallback}</>;
}
