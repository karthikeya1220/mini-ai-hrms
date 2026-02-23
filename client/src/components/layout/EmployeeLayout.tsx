import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function EmployeeLayout() {
    return (
        <div className="flex min-h-screen bg-slate-950">
            <Sidebar role="EMPLOYEE" />
            <main className="flex-1 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}
