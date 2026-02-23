// components/dashboard/ScoreBadge.tsx
// Colour-coded badge based on the SPEC grade thresholds (A+/A/B/C/D).

interface ScoreBadgeProps {
    rate: number;   // 0–1 completion rate
    size?: 'sm' | 'md';
}

function rateToGrade(rate: number): { grade: string; label: string; color: string; bg: string } {
    const pct = rate * 100;
    if (pct >= 90) return { grade: 'A+', label: 'Excellent', color: 'text-emerald-300', bg: 'bg-emerald-500/15 border-emerald-500/30' };
    if (pct >= 80) return { grade: 'A', label: 'Great', color: 'text-blue-300', bg: 'bg-blue-500/15 border-blue-500/30' };
    if (pct >= 70) return { grade: 'B', label: 'Good', color: 'text-indigo-300', bg: 'bg-indigo-500/15 border-indigo-500/30' };
    if (pct >= 60) return { grade: 'C', label: 'Fair', color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/30' };
    return { grade: 'D', label: 'Low', color: 'text-red-300', bg: 'bg-red-500/15 border-red-500/30' };
}

export function ScoreBadge({ rate, size = 'md' }: ScoreBadgeProps) {
    const { grade, label, color, bg } = rateToGrade(rate);
    const pct = Math.round(rate * 100);

    const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
    const gradeSize = size === 'sm' ? 'text-sm font-bold' : 'text-base font-extrabold';

    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${bg} ${textSize}`}
            title={`${pct}% — ${label}`}
        >
            <span className={`${gradeSize} ${color} tabular-nums`}>{grade}</span>
            <span className="text-slate-500">{pct}%</span>
        </span>
    );
}
