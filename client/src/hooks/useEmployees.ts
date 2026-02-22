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
    params: ListParams = {},
): UseEmployeesResult {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const paramsKey = JSON.stringify(params);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        listEmployees(params)
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
    }, [tick, paramsKey]);

    const refetch = useCallback(() => setTick(t => t + 1), []);

    const addEmployee = useCallback(async (data: EmployeeInput): Promise<Employee> => {
        const emp = await createEmployee(data);
        setEmployees(prev => [emp, ...prev]);
        setTotal(t => t + 1);
        return emp;
    }, []);

    const editEmployee = useCallback(async (id: string, data: Partial<EmployeeInput>): Promise<Employee> => {
        const emp = await updateEmployee(id, data);
        setEmployees(prev => prev.map(e => e.id === id ? emp : e));
        return emp;
    }, []);

    const removeEmployee = useCallback(async (id: string): Promise<Employee> => {
        const emp = await deactivateEmployee(id);
        // Optimistic: keep in list but mark inactive (matching server soft-delete)
        setEmployees(prev => prev.map(e => e.id === id ? emp : e));
        return emp;
    }, []);

    return { employees, total, loading, error, refetch, addEmployee, editEmployee, removeEmployee };
}