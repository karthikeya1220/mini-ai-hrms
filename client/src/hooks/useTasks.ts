// hooks/useTasks.ts — board state + CRUD + optimistic status moves

import { useState, useEffect, useCallback } from 'react';
import { listTasks, listMyTasks, createTask, updateTaskStatus } from '../api/tasks';
import type { Task, CreateTaskInput, TaskStatus, ListTaskParams } from '../api/tasks';

interface UseTasksResult {
    tasks: Task[];
    total: number;
    loading: boolean;
    error: string | null;
    refetch: () => void;
    addTask: (data: CreateTaskInput) => Promise<Task>;
    moveTask: (id: string, newStatus: TaskStatus) => Promise<Task>;
}

export function useTasks(
    token: string | null,
    params: ListTaskParams = {},
    isMy: boolean = false
): UseTasksResult {
    const [tasks, setTasks] = useState<Task[]>([]);
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

        const fetcher = isMy ? listMyTasks : listTasks;

        fetcher(token, { limit: 100, ...params })
            .then(r => { if (!cancelled) { setTasks(r.data); setTotal(r.total); setLoading(false); } })
            .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, tick, paramsKey, isMy]);

    const refetch = useCallback(() => setTick(t => t + 1), []);

    const addTask = useCallback(async (data: CreateTaskInput): Promise<Task> => {
        if (!token) throw new Error('Not authenticated');
        const task = await createTask(token, data);
        setTasks(prev => [task, ...prev]);
        setTotal(t => t + 1);
        return task;
    }, [token]);

    /** Optimistically moves the card then syncs with server */
    const moveTask = useCallback(async (id: string, newStatus: TaskStatus): Promise<Task> => {
        if (!token) throw new Error('Not authenticated');
        // 1. Optimistic update — card snaps to new column immediately
        setTasks(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));
        try {
            const updated = await updateTaskStatus(token, id, newStatus);
            // 2. Sync server response (in case completedAt was stamped, etc.)
            setTasks(prev => prev.map(t => t.id === id ? updated : t));
            return updated;
        } catch (err) {
            // 3. Roll back on failure
            setTasks(prev => prev.map(t => t.id === id
                ? { ...t, status: t.status }   // revert (we don't have old status, refetch)
                : t
            ));
            refetch();
            throw err;
        }
    }, [token, refetch]);

    return { tasks, total, loading, error, refetch, addTask, moveTask };
}
