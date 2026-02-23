// =============================================================================
// pages/LandingPage.tsx
// Mini AI-HRMS — Production-grade AI-powered HRMS by RizeOS
// Content sourced directly from SPEC.md + README.md
// Sections: Navbar · Hero · How it Works · Features · AI Scoring ·
//           Tech Stack · App Preview · CTA · Footer
// =============================================================================

import { Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useInView(threshold = 0.12) {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            ([e]) => { if (e.isIntersecting) setInView(true); },
            { threshold },
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [threshold]);
    return { ref, inView };
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const fn = () => setScrolled(window.scrollY > 24);
        window.addEventListener('scroll', fn, { passive: true });
        return () => window.removeEventListener('scroll', fn);
    }, []);

    return (
        <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300
            ${scrolled ? 'bg-black/85 backdrop-blur-xl border-b border-white/5 shadow-xl' : 'bg-transparent'}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">

                {/* Logo */}
                <Link to="/" className="flex items-center gap-2.5 flex-shrink-0">
                    <span className="w-8 h-8 rounded-xl bg-lime-400 flex items-center justify-center shadow-lg shadow-lime-400/25">
                        <svg viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                            <path d="M12 3L4 20h16L12 3z" /><line x1="7.5" y1="13" x2="16.5" y2="13" />
                        </svg>
                    </span>
                    <div className="leading-none">
                        <span className="text-sm font-extrabold text-white tracking-tight">Mini AI-HRMS</span>
                        <span className="block text-[9px] text-lime-400 font-semibold tracking-widest uppercase">by RizeOS</span>
                    </div>
                </Link>

                {/* Desktop nav */}
                <nav className="hidden md:flex items-center gap-1 text-sm">
                    {[
                        { label: 'Features',     href: '#features'      },
                        { label: 'How it Works', href: '#how-it-works'  },
                        { label: 'AI Scoring',   href: '#scoring'       },
                        { label: 'Tech Stack',   href: '#stack'         },
                    ].map(n => (
                        <a key={n.label} href={n.href}
                            className="px-3 py-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                            {n.label}
                        </a>
                    ))}
                </nav>

                {/* Desktop CTAs */}
                <div className="hidden md:flex items-center gap-3">
                    <Link to="/login"
                        className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                        Sign in
                    </Link>
                    <Link to="/register"
                        className="px-4 py-2 text-sm font-bold text-black bg-lime-400 hover:bg-lime-300 rounded-xl transition-colors shadow-lg shadow-lime-500/20">
                        Get Started Free
                    </Link>
                </div>

                {/* Mobile hamburger */}
                <button className="md:hidden p-2 text-slate-400 hover:text-white rounded-lg"
                    onClick={() => setMenuOpen(v => !v)} aria-label="Menu">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
                        {menuOpen
                            ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                            : <><line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" /></>
                        }
                    </svg>
                </button>
            </div>

            {/* Mobile menu */}
            {menuOpen && (
                <div className="md:hidden border-t border-white/5 bg-black/95 px-4 pb-5 pt-3 space-y-1">
                    {['Features','How it Works','AI Scoring','Tech Stack'].map(l => (
                        <a key={l} href={`#${l.toLowerCase().replace(/\s+/g, '-')}`}
                            onClick={() => setMenuOpen(false)}
                            className="block px-3 py-2.5 text-sm text-slate-300 hover:text-white rounded-lg hover:bg-white/5 transition-colors">{l}</a>
                    ))}
                    <div className="pt-3 flex flex-col gap-3">
                        <Link to="/login"     className="block text-center py-2.5 text-sm border border-white/10 rounded-xl text-slate-300 hover:text-white transition-colors">Sign in</Link>
                        <Link to="/register"  className="block text-center py-2.5 text-sm font-bold text-black bg-lime-400 hover:bg-lime-300 rounded-xl transition-colors">Get Started Free</Link>
                    </div>
                </div>
            )}
        </header>
    );
}

// ─── Hero floating mockup — real project data ─────────────────────────────────

function HeroMockup() {
    return (
        <div className="relative w-full h-[440px] sm:h-[500px] select-none pointer-events-none">

            {/* Org productivity score */}
            <div className="absolute top-4 right-0 w-56 rounded-2xl bg-[#0f0f0f] border border-white/8 p-4 shadow-2xl">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-0.5">Org Productivity Score</p>
                <p className="text-3xl font-black text-white">87<span className="text-base font-medium text-slate-500">/100</span></p>
                <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5">
                        <div className="h-1.5 rounded-full bg-lime-400" style={{ width: '87%' }} />
                    </div>
                    <span className="text-[10px] text-lime-400 font-bold flex-shrink-0">Grade A</span>
                </div>
                <p className="text-[10px] text-emerald-400 mt-2 flex items-center gap-1">↑ 4.2% <span className="text-slate-600">vs last month</span></p>
            </div>

            {/* AI Recommendation — real formula from SPEC */}
            <div className="absolute top-[115px] left-0 w-54 rounded-2xl bg-[#0f0f0f] border border-indigo-500/25 p-3.5 shadow-xl">
                <p className="text-[9px] text-indigo-400 uppercase tracking-widest font-semibold mb-2">🤖 AI Recommendation</p>
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-6 h-6 rounded-full bg-indigo-900 flex items-center justify-center text-[9px] font-bold text-indigo-300 flex-shrink-0">DK</span>
                    <div>
                        <p className="text-[11px] font-semibold text-white leading-none">Darshan K.</p>
                        <p className="text-[9px] text-slate-500">Rank score: 94.5</p>
                    </div>
                </div>
                <p className="text-[9px] text-slate-600 font-mono leading-relaxed">
                    (3 skills × 30) + (9 tasks × 20) + (92 × 0.5)
                </p>
            </div>

            {/* Kanban column — forward-only state machine */}
            <div className="absolute top-0 left-[148px] w-36 rounded-xl bg-[#0f0f0f] border border-white/8 p-3 shadow-lg">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-2 font-semibold">In Progress · 3</p>
                {[
                    { title: 'Build Auth API',   pct: 80, col: 'bg-red-500'    },
                    { title: 'UI Dashboard',     pct: 55, col: 'bg-amber-500'  },
                    { title: 'Write Unit Tests', pct: 30, col: 'bg-sky-500'    },
                ].map(t => (
                    <div key={t.title} className="mb-1.5 rounded-lg bg-white/3 border border-white/5 px-2 py-1.5">
                        <p className="text-[10px] text-slate-300 truncate">{t.title}</p>
                        <div className="mt-1 h-0.5 rounded-full bg-white/5">
                            <div className={`h-0.5 rounded-full ${t.col}`} style={{ width: `${t.pct}%` }} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Blockchain log — WorkforceLogger.sol output */}
            <div className="absolute bottom-[135px] right-0 w-52 rounded-xl bg-[#0f0f0f] border border-emerald-500/20 p-3 shadow-xl">
                <p className="text-[9px] text-emerald-500 uppercase tracking-widest font-semibold mb-2">⛓ WorkforceLogger.sol</p>
                <p className="text-[10px] text-slate-400">logTaskCompletion()</p>
                <p className="text-[9px] font-mono text-emerald-400 mt-1 truncate">tx: 0x4f2a…c3d1</p>
                <p className="text-[9px] text-slate-600 mt-0.5">Polygon Amoy · Confirmed</p>
            </div>

            {/* Score breakdown — real 3-factor formula */}
            <div className="absolute bottom-4 left-0 w-52 rounded-xl bg-[#0f0f0f] border border-white/8 p-3 shadow-xl">
                <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Score Breakdown</p>
                {[
                    { label: 'Completion Rate ×0.40', val: '92%',   color: 'text-sky-400'   },
                    { label: 'On-Time Rate ×0.35',    val: '88%',   color: 'text-amber-400' },
                    { label: 'Avg Complexity ×0.25',  val: '3.4/5', color: 'text-pink-400'  },
                ].map(s => (
                    <div key={s.label} className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-slate-600 flex-1 truncate">{s.label}</span>
                        <span className={`text-[9px] font-bold ml-2 flex-shrink-0 ${s.color}`}>{s.val}</span>
                    </div>
                ))}
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[9px] text-slate-500">Final Score</span>
                    <span className="text-sm font-black text-lime-400">87</span>
                </div>
            </div>

            {/* Employee count pill */}
            <div className="absolute bottom-[225px] left-[155px] bg-[#0f0f0f] border border-white/8 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-lg">
                <div className="flex -space-x-1.5">
                    {['D','K','A','M'].map((l, i) => (
                        <span key={l} className="w-5 h-5 rounded-full border border-black flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ background: `hsl(${i * 70 + 200},50%,30%)` }}>{l}</span>
                    ))}
                </div>
                <span className="text-[10px] text-slate-400 font-medium">24 employees · multi-tenant</span>
            </div>
        </div>
    );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
    const { ref, inView } = useInView(0.05);

    return (
        <section ref={ref} className="relative min-h-[92dvh] flex flex-col justify-center overflow-hidden pt-24 pb-16">
            {/* Background glows */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-15%] left-[15%] w-[600px] h-[600px] rounded-full bg-lime-500/8 blur-[130px]" />
                <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] rounded-full bg-lime-400/5 blur-[100px]" />
                <div className="absolute bottom-0 left-[5%] w-[300px] h-[300px] rounded-full bg-indigo-500/5 blur-[80px]" />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 lg:gap-8 items-center relative z-10">
                {/* Left — copy */}
                <div className={`transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-lime-400/25 bg-lime-400/8 mb-6">
                        <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
                        <span className="text-[11px] font-semibold text-lime-400 uppercase tracking-widest">
                            RizeOS Assessment · Production Grade
                        </span>
                    </div>

                    <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold text-white leading-[1.08] tracking-tight mb-6">
                        AI-Powered HR with
                        <span className="block text-lime-400">immutable audit trails.</span>
                    </h1>

                    <p className="text-slate-400 text-base sm:text-lg leading-relaxed mb-8 max-w-lg">
                        Multi-tenant HRMS with a deterministic AI scoring engine, forward-only Kanban state machine,
                        and every task completion cryptographically logged on&nbsp;Polygon Amoy via{' '}
                        <span className="font-mono text-lime-400/80 text-sm">WorkforceLogger.sol</span>.
                    </p>

                    <div className="flex flex-col xs:flex-row gap-3 mb-10">
                        <Link to="/register"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-black bg-lime-400 hover:bg-lime-300 transition-colors shadow-lg shadow-lime-500/20">
                            Create Free Workspace
                        </Link>
                        <Link to="/login"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-slate-300 border border-white/10 hover:border-white/20 hover:text-white hover:bg-white/5 transition-all">
                            Sign in to your org →
                        </Link>
                    </div>

                    {/* Real stats from SPEC */}
                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                        {[
                            { label: 'AI scoring factors',   value: '3-factor' },
                            { label: 'API response target',  value: '<100 ms'  },
                            { label: 'Blockchain network',   value: 'Polygon Amoy' },
                            { label: 'Tenancy model',        value: 'Multi-tenant' },
                        ].map(s => (
                            <div key={s.label}>
                                <p className="text-lg font-extrabold text-white">{s.value}</p>
                                <p className="text-[11px] text-slate-600">{s.label}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right — floating mockup */}
                <div className={`transition-all duration-700 delay-200 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
                    <HeroMockup />
                </div>
            </div>
        </section>
    );
}

// ─── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
    const { ref, inView } = useInView();

    const steps = [
        {
            num: '01',
            title: 'Register your organisation',
            body: 'Sign up as Admin. Your org is provisioned instantly and fully isolated from every other tenant via <code>orgId</code> scoping on every single database query — never from the client request body.',
            color: 'lime',
        },
        {
            num: '02',
            title: 'Add employees & assign tasks',
            body: 'Create employee profiles with <code>skills[]</code>, department, and wallet address. Use the Kanban board to assign tasks. The AI immediately ranks best-fit employees by skill overlap, active workload, and productivity score.',
            color: 'sky',
        },
        {
            num: '03',
            title: 'BullMQ rescores automatically',
            body: 'Every task close enqueues a BullMQ job. The job recomputes the employee\'s score: <code>40% completion + 35% on-time + 25% complexity</code>. Redis backs the queue — jobs survive restarts.',
            color: 'violet',
        },
        {
            num: '04',
            title: 'Polygon logs the event',
            body: 'Task completion calls <code>WorkforceLogger.logTaskCompletion()</code> on Polygon Amoy. The resulting tx hash is stored in <code>blockchain_logs</code> — tamper-proof, peer-verifiable proof-of-work.',
            color: 'emerald',
        },
    ] as const;

    const colorMap: Record<string, string> = {
        lime:    'text-lime-400 border-lime-400/20 bg-lime-400/8',
        sky:     'text-sky-400 border-sky-400/20 bg-sky-400/8',
        violet:  'text-violet-400 border-violet-400/20 bg-violet-400/8',
        emerald: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/8',
    };

    return (
        <section id="how-it-works" ref={ref} className="py-24 relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className={`text-center mb-14 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                    <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-400 bg-lime-400/8 border border-lime-400/20 rounded-full mb-4">
                        How it works
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                        One task close. Four cascading effects.
                    </h2>
                    <p className="mt-3 text-slate-500 max-w-xl mx-auto text-sm">
                        A single status change triggers AI rescoring, blockchain logging, and Redis cache invalidation — all under 100 ms API response time.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {steps.map((s, i) => (
                        <div
                            key={s.num}
                            className={`relative rounded-2xl border border-white/5 bg-white/[0.025] p-6 hover:border-white/10 hover:bg-white/[0.04] transition-all duration-300
                                ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                            style={{ transitionDelay: `${i * 90}ms` }}
                        >
                            <span className={`inline-block text-2xl font-black mb-4 px-2.5 py-1 rounded-lg border ${colorMap[s.color]}`}>
                                {s.num}
                            </span>
                            <h3 className="text-sm font-bold text-white mb-2 leading-snug">{s.title}</h3>
                            <p className="text-xs text-slate-500 leading-relaxed"
                                dangerouslySetInnerHTML={{
                                    __html: s.body
                                        .replace(/<code>/g, '<code class="font-mono text-lime-400/80 bg-lime-400/5 px-1 rounded">')
                                        .replace(/<\/code>/g, '</code>'),
                                }}
                            />
                            {i < steps.length - 1 && (
                                <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-slate-700 text-lg z-10">→</div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ─── Features grid ────────────────────────────────────────────────────────────

const FEATURES = [
    {
        icon: '📊',
        title: 'Multi-Tenant Dashboard',
        description: 'Redis-cached org stats with 60 s TTL. Every query is scoped by orgId — set server-side from the JWT, never from client request body.',
        accent: 'lime',
    },
    {
        icon: '✅',
        title: 'Forward-Only Kanban FSM',
        description: 'State transitions Assigned → In Progress → Completed are enforced server-side. No backwards moves. Guards run before every PATCH /tasks/:id.',
        accent: 'sky',
    },
    {
        icon: '🤖',
        title: 'AI Recommendation Engine',
        description: 'Deterministic ranking: Rank = (SkillOverlap × 30) + ((10 − ActiveTasks) × 20) + (Score × 0.5). GPT-4o generates a plain-English explanation.',
        accent: 'violet',
    },
    {
        icon: '⛓',
        title: 'WorkforceLogger.sol',
        description: 'Every task completion calls logTaskCompletion(empId, taskId, timestamp) on Polygon Amoy. tx_hash stored in blockchain_logs table — tamper-proof.',
        accent: 'emerald',
    },
    {
        icon: '🔐',
        title: 'JWT Hardening',
        description: '1 h access token stored in memory only. 7 d refresh token in httpOnly SameSite:Strict cookie. orgId injected from DB — never from the client.',
        accent: 'rose',
    },
    {
        icon: '⚡',
        title: 'Async BullMQ Scoring',
        description: 'Task close enqueues a BullMQ job backed by Redis. API returns <100 ms. The queue survives restarts and rehydrates automatically.',
        accent: 'amber',
    },
    {
        icon: '👥',
        title: 'Employee Profiles',
        description: 'Each employee carries skills[], department, wallet_address, and a full score_breakdown JSON showing exactly how their score was computed.',
        accent: 'cyan',
    },
    {
        icon: '🧠',
        title: 'Explainable Scoring',
        description: 'No ML black box. Score = (completion × 0.40) + (on-time × 0.35) + (complexity/5 × 0.25 × 100). Fully auditable JSON per employee.',
        accent: 'fuchsia',
    },
] as const;

const FEATURE_ACCENT: Record<string, string> = {
    lime:    'bg-lime-400/10 text-lime-400 border-lime-400/20',
    sky:     'bg-sky-400/10 text-sky-400 border-sky-400/20',
    violet:  'bg-violet-400/10 text-violet-400 border-violet-400/20',
    emerald: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    rose:    'bg-rose-400/10 text-rose-400 border-rose-400/20',
    amber:   'bg-amber-400/10 text-amber-400 border-amber-400/20',
    cyan:    'bg-cyan-400/10 text-cyan-400 border-cyan-400/20',
    fuchsia: 'bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20',
};

function Features() {
    const { ref, inView } = useInView();

    return (
        <section id="features" ref={ref} className="py-24 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-lime-500/4 blur-[120px]" />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className={`text-center mb-14 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-400 bg-lime-400/8 border border-lime-400/20 rounded-full mb-4">
                        Core Features
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                        Eight production-grade pillars.
                        <span className="block text-slate-500 text-2xl sm:text-3xl font-bold mt-1">Zero hand-waving.</span>
                    </h2>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {FEATURES.map((f, i) => (
                        <div
                            key={f.title}
                            className={`rounded-2xl border border-white/5 bg-white/[0.025] p-6 hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300 cursor-default
                                ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                            style={{ transitionDelay: `${i * 60}ms` }}
                        >
                            <div className={`inline-flex w-11 h-11 items-center justify-center rounded-xl border text-xl mb-4 ${FEATURE_ACCENT[f.accent]}`}>
                                {f.icon}
                            </div>
                            <h3 className="text-sm font-bold text-white mb-2 leading-snug">{f.title}</h3>
                            <p className="text-xs text-slate-500 leading-relaxed">{f.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ─── Scoring Formula ──────────────────────────────────────────────────────────

function ScoringFormula() {
    const { ref, inView } = useInView();

    const grades = [
        { grade: 'A+', range: '≥ 90', color: 'text-lime-400',    bg: 'bg-lime-400/8 border-lime-400/20' },
        { grade: 'A',  range: '≥ 80', color: 'text-emerald-400', bg: 'bg-emerald-400/8 border-emerald-400/20' },
        { grade: 'B',  range: '≥ 70', color: 'text-sky-400',     bg: 'bg-sky-400/8 border-sky-400/20' },
        { grade: 'C',  range: '≥ 60', color: 'text-amber-400',   bg: 'bg-amber-400/8 border-amber-400/20' },
        { grade: 'D',  range: '< 60', color: 'text-rose-400',    bg: 'bg-rose-400/8 border-rose-400/20' },
    ];

    const factors = [
        { label: 'Completion Rate', weight: '×0.40', pct: 40, color: 'bg-lime-400' },
        { label: 'On-Time Rate',    weight: '×0.35', pct: 35, color: 'bg-sky-400'  },
        { label: 'Avg Complexity',  weight: '×0.25', pct: 25, color: 'bg-violet-400' },
    ];

    return (
        <section id="scoring" ref={ref} className="py-24 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-lime-500/4 blur-[140px]" />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className={`text-center mb-14 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                    <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-400 bg-lime-400/8 border border-lime-400/20 rounded-full mb-4">
                        Scoring & Ranking
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                        Deterministic. Auditable. No black box.
                    </h2>
                    <p className="mt-3 text-slate-500 text-sm max-w-lg mx-auto">
                        Scores are computed from three concrete metrics. Every employee can inspect their own JSON breakdown.
                    </p>
                </div>

                <div className="grid lg:grid-cols-2 gap-8 items-start">
                    {/* Grade table */}
                    <div className={`transition-all duration-700 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Performance Grades</p>
                        <div className="space-y-2">
                            {grades.map(g => (
                                <div key={g.grade} className={`flex items-center gap-4 px-4 py-3 rounded-xl border ${g.bg}`}>
                                    <span className={`text-2xl font-black w-10 ${g.color}`}>{g.grade}</span>
                                    <span className="text-sm text-slate-300 font-medium">Score {g.range}</span>
                                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden ml-auto" style={{ maxWidth: 120 }}>
                                        <div className={`h-full rounded-full ${g.color.replace('text-', 'bg-')}`}
                                            style={{ width: `${g.grade === 'A+' ? 100 : g.grade === 'A' ? 85 : g.grade === 'B' ? 68 : g.grade === 'C' ? 55 : 35}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Formula card */}
                    <div className={`transition-all duration-700 delay-150 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
                        <div className="rounded-2xl border border-white/8 bg-[#0a0a0a] p-6">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Productivity Score Formula</p>
                            <div className="font-mono text-[11px] text-lime-400 bg-lime-400/5 border border-lime-400/15 rounded-xl px-4 py-3 mb-6 leading-relaxed">
                                Score =<br />
                                {'  '}(CompletionRate × 0.40)<br />
                                + (OnTimeRate × 0.35)<br />
                                + (AvgComplexity / 5 × 0.25 × 100)
                            </div>

                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Factor Weights</p>
                            <div className="space-y-3 mb-6">
                                {factors.map(f => (
                                    <div key={f.label}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-slate-400">{f.label}</span>
                                            <span className="text-xs font-mono text-slate-500">{f.weight}</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                            <div className={`h-full rounded-full ${f.color} transition-all duration-1000`}
                                                style={{ width: inView ? `${f.pct * 2}%` : '0%' }} />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">AI Recommendation Rank</p>
                            <div className="font-mono text-[11px] text-sky-400 bg-sky-400/5 border border-sky-400/15 rounded-xl px-4 py-3 leading-relaxed">
                                Rank =<br />
                                {'  '}(SkillOverlap × 30)<br />
                                + ((10 − ActiveTaskCount) × 20)<br />
                                + (ProductivityScore × 0.5)
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─── Tech Stack ───────────────────────────────────────────────────────────────

const STACK_CATEGORIES = [
    { label: 'Frontend',    color: 'lime',    items: ['React 18', 'TypeScript', 'Tailwind CSS', 'Vite', 'React Router v6'] },
    { label: 'Backend',     color: 'sky',     items: ['Node.js', 'Express', 'Prisma ORM', 'Zod Validation', 'BullMQ'] },
    { label: 'Database',    color: 'violet',  items: ['PostgreSQL (Neon)', 'Redis', 'Prisma Migrations'] },
    { label: 'AI Engine',   color: 'amber',   items: ['Deterministic Scoring', 'GPT-4o Explanations', 'In-process Engine'] },
    { label: 'Blockchain',  color: 'emerald', items: ['Solidity (WorkforceLogger.sol)', 'Ethers.js', 'Polygon Amoy', 'MetaMask'] },
    { label: 'Auth',        color: 'rose',    items: ['JWT (access + refresh)', 'httpOnly Cookies', 'Bcryptjs', 'Rate Limiting'] },
    { label: 'Deploy',      color: 'cyan',    items: ['Vercel (Frontend)', 'Railway (Backend)', 'GitHub CI/CD'] },
    { label: 'Security',    color: 'fuchsia', items: ['CORS Allowlist', 'orgId Scoping', 'No TOCTOU', 'Startup Guards'] },
] as const;

const STACK_ACCENT: Record<string, string> = {
    lime:    'border-lime-400/20 text-lime-400 bg-lime-400/5',
    sky:     'border-sky-400/20 text-sky-400 bg-sky-400/5',
    violet:  'border-violet-400/20 text-violet-400 bg-violet-400/5',
    amber:   'border-amber-400/20 text-amber-400 bg-amber-400/5',
    emerald: 'border-emerald-400/20 text-emerald-400 bg-emerald-400/5',
    rose:    'border-rose-400/20 text-rose-400 bg-rose-400/5',
    cyan:    'border-cyan-400/20 text-cyan-400 bg-cyan-400/5',
    fuchsia: 'border-fuchsia-400/20 text-fuchsia-400 bg-fuchsia-400/5',
};

function TechStack() {
    const { ref, inView } = useInView();

    return (
        <section id="stack" ref={ref} className="py-24 relative overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className={`text-center mb-14 transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                    <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-400 bg-lime-400/8 border border-lime-400/20 rounded-full mb-4">
                        Technology Stack
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                        Every layer is production-grade.
                    </h2>
                    <p className="mt-3 text-slate-500 text-sm max-w-lg mx-auto">
                        Eight clearly separated tiers — each chosen to solve a specific reliability or security requirement from the SPEC.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {STACK_CATEGORIES.map((cat, i) => (
                        <div
                            key={cat.label}
                            className={`rounded-2xl border border-white/5 bg-white/[0.025] p-5 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300
                                ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                            style={{ transitionDelay: `${i * 60}ms` }}
                        >
                            <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${STACK_ACCENT[cat.color].split(' ')[1]}`}>
                                {cat.label}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {cat.items.map(item => (
                                    <span key={item}
                                        className={`inline-block px-2 py-1 rounded-lg text-[10px] font-medium border ${STACK_ACCENT[cat.color]}`}>
                                        {item}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// ─── App preview mockup ───────────────────────────────────────────────────────

function AppPreview() {
    const { ref, inView } = useInView(0.1);

    return (
        <section ref={ref} className="py-16 pb-24">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className={`rounded-3xl border border-white/5 bg-[#0a0a0a] overflow-hidden shadow-2xl transition-all duration-700 ${inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
                    {/* Browser chrome */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                        <span className="w-3 h-3 rounded-full bg-red-500/60" />
                        <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                        <span className="w-3 h-3 rounded-full bg-green-500/60" />
                        <div className="flex-1 mx-4 h-6 rounded-lg bg-white/5 flex items-center px-3">
                            <span className="text-[11px] text-slate-600">mini-ai-hrms.vercel.app/dashboard</span>
                        </div>
                    </div>

                    {/* Dashboard preview */}
                    <div className="flex h-72 sm:h-96">
                        {/* Sidebar */}
                        <div className="hidden sm:flex flex-col w-44 border-r border-white/5 bg-[#0d0d0d] p-3 gap-1">
                            <div className="flex items-center gap-2 px-2 py-2 mb-3">
                                <span className="w-6 h-6 rounded-lg bg-lime-400 flex items-center justify-center flex-shrink-0">
                                    <svg viewBox="0 0 16 16" fill="none" stroke="black" strokeWidth="2.5" className="w-3 h-3">
                                        <polygon points="8,2 14,14 2,14" />
                                    </svg>
                                </span>
                                <span className="text-xs font-bold text-white">Mini AI-HRMS</span>
                            </div>
                            {['Dashboard', 'Employees', 'Task Board', 'AI Insights', 'Blockchain'].map((l, i) => (
                                <div key={l} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${i === 0 ? 'bg-lime-400/10 text-lime-400' : 'text-slate-600'}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                                    {l}
                                </div>
                            ))}
                        </div>

                        {/* Main area */}
                        <div className="flex-1 p-4 sm:p-6 overflow-hidden">
                            <p className="text-xs text-slate-500 mb-4">Welcome back, <span className="text-white">Admin</span> · Org score: <span className="text-lime-400 font-bold">87</span> <span className="text-slate-600">(Grade A)</span></p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                                {[
                                    { label: 'Employees',    val: '12',  sub: 'orgId-scoped',         color: 'lime'   },
                                    { label: 'Active Tasks', val: '31',  sub: 'Assigned + In Progress', color: 'sky'    },
                                    { label: 'Avg Score',    val: '87',  sub: 'Grade A',               color: 'violet' },
                                ].map(s => (
                                    <div key={s.label} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                                        <p className="text-[10px] text-slate-500">{s.label}</p>
                                        <p className={`text-xl font-bold ${s.color === 'lime' ? 'text-lime-400' : s.color === 'sky' ? 'text-sky-400' : 'text-violet-400'}`}>{s.val}</p>
                                        <p className="text-[9px] text-slate-700 mt-0.5">{s.sub}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                {[
                                    { name: 'Darshan K.', score: 92, grade: 'A+', chain: true  },
                                    { name: 'Priya M.',   score: 87, grade: 'A',  chain: true  },
                                    { name: 'Carlos R.',  score: 74, grade: 'B',  chain: false },
                                ].map((e, i) => (
                                    <div key={e.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5">
                                        <span className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[9px] text-white font-bold flex-shrink-0">
                                            {e.name[0]}
                                        </span>
                                        <span className="text-xs text-slate-400 flex-1 truncate">{e.name}</span>
                                        <span className={`text-[10px] font-bold ${i === 0 ? 'text-lime-400' : i === 1 ? 'text-emerald-400' : 'text-sky-400'}`}>
                                            {e.score} · {e.grade}
                                        </span>
                                        {e.chain && <span className="text-[10px] text-emerald-400">⛓ logged</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────

function CTA() {
    const { ref, inView } = useInView();

    return (
        <section ref={ref} className="py-24 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-lime-400/8 blur-[100px]" />
                <div className="absolute top-0 left-0 w-[300px] h-[300px] rounded-full bg-lime-400/5 blur-[80px]" />
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <div className={`transition-all duration-700 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`}>
                        <span className="inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-lime-400 bg-lime-400/8 border border-lime-400/20 rounded-full mb-4">
                            Get started for free
                        </span>
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4 leading-tight">
                            The best-in-class HR platform
                            <span className="block text-lime-400">built for engineers.</span>
                        </h2>
                        <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-md">
                            Multi-tenant by design. Deterministic AI scoring — no ML black box, every formula is in the SPEC. Blockchain audit trail on Polygon Amoy.
                            Deploy on Vercel + Railway in under 10 minutes.
                        </p>
                        <div className="flex flex-col xs:flex-row gap-3">
                            <Link to="/register"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-black bg-lime-400 hover:bg-lime-300 transition-colors shadow-lg shadow-lime-500/20">
                                Create Free Workspace
                            </Link>
                            <Link to="/login"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-slate-300 border border-white/10 hover:border-white/20 hover:text-white transition-all">
                                Sign in to your org →
                            </Link>
                        </div>
                    </div>

                    <div className={`hidden lg:flex items-center justify-center transition-all duration-700 delay-200 ${inView ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
                        <div className="relative">
                            <div className="w-64 h-64 rounded-full border border-lime-400/10 flex items-center justify-center">
                                <div className="w-48 h-48 rounded-full border border-lime-400/15 flex items-center justify-center">
                                    <div className="w-32 h-32 rounded-full bg-lime-400/8 border border-lime-400/20 flex items-center justify-center">
                                        <div className="text-center">
                                            <p className="text-2xl font-black text-lime-400">87</p>
                                            <p className="text-[10px] text-slate-600 mt-0.5">Grade A</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {[0, 60, 120, 180, 240, 300].map((deg) => (
                                <span key={deg}
                                    className="absolute w-2 h-2 rounded-full bg-lime-400/50"
                                    style={{
                                        top:  `${50 - 47 * Math.cos(deg * Math.PI / 180)}%`,
                                        left: `${50 + 47 * Math.sin(deg * Math.PI / 180)}%`,
                                        transform: 'translate(-50%,-50%)',
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
    return (
        <footer className="border-t border-white/5 py-12">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
                    {/* Brand */}
                    <div>
                        <div className="flex items-center gap-2.5 mb-4">
                            <span className="w-8 h-8 rounded-xl bg-lime-400 flex items-center justify-center flex-shrink-0">
                                <svg viewBox="0 0 16 16" fill="none" stroke="black" strokeWidth="2.5" className="w-4 h-4">
                                    <polygon points="8,2 14,14 2,14" />
                                </svg>
                            </span>
                            <div>
                                <p className="text-sm font-bold text-white leading-tight">Mini AI-HRMS</p>
                                <p className="text-[10px] text-slate-600">by RizeOS</p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            Production-grade AI-powered HRMS built as a RizeOS Founder/Engineer Intern Assessment.
                        </p>
                    </div>

                    {/* Product */}
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Product</p>
                        <ul className="space-y-2">
                            {['Dashboard', 'Kanban Board', 'AI Insights', 'Blockchain Logs', 'Employee Profiles'].map(l => (
                                <li key={l}><span className="text-sm text-slate-500 hover:text-slate-300 transition-colors cursor-default">{l}</span></li>
                            ))}
                        </ul>
                    </div>

                    {/* Tech */}
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Technology</p>
                        <ul className="space-y-2">
                            {['React + TypeScript', 'Node.js + Prisma', 'PostgreSQL + Redis', 'Polygon Amoy', 'BullMQ + Zod'].map(l => (
                                <li key={l}><span className="text-sm text-slate-500 hover:text-slate-300 transition-colors cursor-default">{l}</span></li>
                            ))}
                        </ul>
                    </div>

                    {/* Project */}
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Project</p>
                        <ul className="space-y-2">
                            {['SPEC.md', 'README.md', 'GitHub Repo', 'RizeOS Assessment', 'License: MIT'].map(l => (
                                <li key={l}><span className="text-sm text-slate-500 hover:text-slate-300 transition-colors cursor-default">{l}</span></li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-slate-700">© 2026 Mini AI-HRMS · RizeOS Founder/Engineer Intern Assessment · MIT License</p>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-700">Vercel + Railway</span>
                        <span className="text-xs text-slate-700">Polygon Amoy</span>
                        <span className="text-xs text-slate-700">Neon DB</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
    return (
        <div className="bg-black text-white min-h-dvh">
            <Navbar />
            <Hero />
            <HowItWorks />
            <Features />
            <ScoringFormula />
            <TechStack />
            <AppPreview />
            <CTA />
            <Footer />
        </div>
    );
}
