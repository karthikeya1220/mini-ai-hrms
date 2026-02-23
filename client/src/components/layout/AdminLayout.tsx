import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AdminLayout() {
    return (
        <div className="flex min-h-screen bg-black">
            <Sidebar role="ADMIN" />
            {/* pt-14 = mobile top-bar height; md:pt-0 = rail/desktop has no top bar */}
            <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
                <Outlet />
            </main>
        </div>
    );
}
