// hooks/useDashboard.ts — data-fetching hook for the dashboard.
// Encapsulates loading / error / refetch state so DashboardPage stays clean.

import { useState, useEffect, useCallback } from 'react';
import { fetchDashboard } from '../api/dashboard';
import type { DashboardData } from '../api/dashboard';

interface UseDashboardResult {
    data: DashboardData | null;
    loading: boolean;
    error: string | null;
    refetch: () => void;
}

export function useDashboard(): UseDashboardResult {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;

        fetchDashboard()
            .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
            .catch(e => { if (!cancelled) { setError(String(e.message)); setLoading(false); } });

        return () => { cancelled = true; };
    }, [tick]);

    const refetch = useCallback(() => {
        setLoading(true);
        setError(null);
        setTick(t => t + 1);
    }, []);

    return { data, loading, error, refetch };
}
