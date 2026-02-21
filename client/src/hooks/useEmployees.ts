// hooks/useEmployees.ts — list + CRUD state for the employees page.
// Keeps local optimistic state in sync with server responses.

import { useState, useEffect, useCallback } from 'react';
import {
    listEmployees,
    createEmployee,
    updateEmployee,
    deactivateEmployee,
} from '../api/employees';
import type { Employee, EmployeeInput, ListParams } from '../api/employees';

interface UseEmployeesResult {
    employees: Employee[];
    total: number;
    loading: boolean;
    error: string | null;
    refetch: () => void;
    addEmployee: (data: EmployeeInput) => Promise<Employee>;
    editEmployee: (id: string, data: Partial<EmployeeInput>) => Promise<Employee>;
    removeEmployee: (id: string) => Promise<Employee>;
}

export function useEmployees(
    token: string | null,
    params: ListParams = {},
): UseEmployeesResult {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const paramsKey = JSON.stringify(params);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        setLoading(true);
        setError(null);

        listEmployees(token, params)
            .then(r => {
                if (!cancelled) {
                    setEmployees(r.data);
                    setTotal(r.total);
                    setLoading(false);
                }
            })
            .catch(e => {
                if (!cancelled) { setError(String(e.message)); setLoading(false); }
            });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, tick, paramsKey]);

    const refetch = useCallback(() => setTick(t => t + 1), []);

    const addEmployee = useCallback(async (data: EmployeeInput): Promise<Employee> => {
        if (!token) throw new Error('Not authenticated');
        const emp = await createEmployee(token, data);
        setEmployees(prev => [emp, ...prev]);
        setTotal(t => t + 1);
        return emp;
    }, [token]);

    const editEmployee = useCallback(async (id: string, data: Partial<EmployeeInput>): Promise<Employee> => {
        if (!token) throw new Error('Not authenticated');
        const emp = await updateEmployee(token, id, data);
        setEmployees(prev => prev.map(e => e.id === id ? emp : e));
        return emp;
    }, [token]);

    const removeEmployee = useCallback(async (id: string): Promise<Employee> => {
        if (!token) throw new Error('Not authenticated');
        const emp = await deactivateEmployee(token, id);
        // Optimistic: keep in list but mark inactive (matching server soft-delete)
        setEmployees(prev => prev.map(e => e.id === id ? emp : e));
        return emp;
    }, [token]);

    return { employees, total, loading, error, refetch, addEmployee, editEmployee, removeEmployee };
}
