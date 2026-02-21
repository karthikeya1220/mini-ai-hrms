// components/dashboard/StatCard.tsx — single KPI tile.
// Animated count-up for numbers, trend arrow, icon slot.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// ─── Count-up animation ───────────────────────────────────────────────────────

function useCountUp(target: number, duration = 900): number {
    const [value, setValue] = useState(0);
    const raf = useRef<number>(0);

    useEffect(() => {
        const start = performance.now();
        const from = 0;

        function tick(now: number) {
            const progress = Math.min((now - start) / duration, 1);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.round(from + (target - from) * eased));
            if (progress < 1) raf.current = requestAnimationFrame(tick);
        }

        raf.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf.current);
    }, [target, duration]);

    return value;
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
    label: string;
    value: number;
    icon: ReactNode;
    accent: string;   // Tailwind gradient classes, e.g. "from-brand-500 to-brand-700"
    suffix?: string;   // e.g. "%" for percentages
    footnote?: string;
    delay?: number;   // stagger animation in ms
}

export function StatCard({
    label, value, icon, accent, suffix = '', footnote, delay = 0,
}: StatCardProps) {
    const [visible, setVisible] = useState(false);
    const animated = useCountUp(visible ? value : 0);

    useEffect(() => {
        const t = setTimeout(() => setVisible(true), delay);
        return () => clearTimeout(t);
    }, [delay]);

    return (
        <div
            className={`
        relative overflow-hidden rounded-2xl border border-slate-800
        bg-slate-900/70 backdrop-blur-sm p-6
        transition-all duration-500
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        hover:border-slate-700 hover:shadow-lg hover:shadow-black/20
        group
      `}
        >
            {/* Ambient icon glow */}
            <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${accent} opacity-10 blur-2xl group-hover:opacity-20 transition-opacity duration-300`} />

            {/* Icon badge */}
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br ${accent} shadow-lg mb-4`}>
                <span className="text-white w-5 h-5">{icon}</span>
            </div>

            {/* Value */}
            <div className="flex items-end gap-1 mb-1">
                <span className="text-4xl font-extrabold tracking-tight text-white tabular-nums">
                    {animated.toLocaleString()}
                </span>
                {suffix && <span className="text-2xl font-bold text-slate-400 mb-0.5">{suffix}</span>}
            </div>

            {/* Label */}
            <p className="text-sm font-medium text-slate-400">{label}</p>

            {/* Optional footnote */}
            {footnote && <p className="mt-2 text-xs text-slate-600">{footnote}</p>}
        </div>
    );
}
