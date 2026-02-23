// components/dashboard/CompletionChart.tsx
// Recharts BarChart — employee completion rates, sorted desc.
// Renders top 12 employees by default to keep the chart readable.

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
    ReferenceLine,
} from 'recharts';
import type { EmployeeStat } from '../../api/dashboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeColor(rate: number): string {
    const pct = rate * 100;
    if (pct >= 90) return '#34d399'; // emerald
    if (pct >= 80) return '#60a5fa'; // blue
    if (pct >= 70) return '#818cf8'; // indigo (brand)
    if (pct >= 60) return '#fbbf24'; // amber
    return '#f87171';                 // red
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

interface TooltipPayload {
    payload?: EmployeeStat & { completionPct: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const d = payload[0].payload;

    return (
        <div className="rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur-sm p-3 shadow-xl text-sm">
            <p className="font-semibold text-white mb-1">{d.name}</p>
            {d.jobTitle && <p className="text-slate-400 text-xs mb-2">{d.jobTitle}</p>}
            <div className="space-y-1">
                <div className="flex justify-between gap-6">
                    <span className="text-slate-500">Completion</span>
                    <span className="font-medium text-white tabular-nums">{d.completionPct}%</span>
                </div>
                <div className="flex justify-between gap-6">
                    <span className="text-slate-500">Tasks done</span>
                    <span className="font-medium text-white tabular-nums">{d.tasksCompleted}/{d.tasksAssigned}</span>
                </div>
                {!d.isActive && (
                    <p className="mt-1 text-xs text-amber-400">⚠ Inactive</p>
                )}
            </div>
        </div>
    );
}

// ─── Chart ────────────────────────────────────────────────────────────────────

interface CompletionChartProps {
    stats: EmployeeStat[];
    orgAvgRate: number;  // 0–1 — drawn as reference line
    maxBars?: number;
}

export function CompletionChart({ stats, orgAvgRate, maxBars = 12 }: CompletionChartProps) {
    const data = stats
        .slice(0, maxBars)
        .map(s => ({
            ...s,
            completionPct: Math.round(s.completionRate * 100),
            // Truncate long names for X axis legibility
            shortName: s.name.split(' ')[0],
        }));

    const orgAvgPct = Math.round(orgAvgRate * 100);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-slate-600 text-sm">
                No employee data yet.
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

                <XAxis
                    dataKey="shortName"
                    tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
                    axisLine={false}
                    tickLine={false}
                />

                <YAxis
                    domain={[0, 100]}
                    tickFormatter={v => `${v}%`}
                    tick={{ fill: '#475569', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                />

                <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ fill: 'rgba(99,102,241,0.05)', radius: 8 }}
                />

                {/* Org average reference line */}
                <ReferenceLine
                    y={orgAvgPct}
                    stroke="#6366f1"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                        value: `Avg ${orgAvgPct}%`,
                        position: 'insideTopRight',
                        fill: '#818cf8',
                        fontSize: 10,
                        fontFamily: 'Inter, sans-serif',
                    }}
                />

                <Bar dataKey="completionPct" radius={[6, 6, 0, 0]} maxBarSize={40}>
                    {data.map((entry, i) => (
                        <Cell key={i} fill={gradeColor(entry.completionRate)} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}
