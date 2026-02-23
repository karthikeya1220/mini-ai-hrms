/**
 * Seed script — populates the DB with realistic demo data.
 * Run from the server/ directory:
 *   npx ts-node scripts/seed.ts
 *
 * Safe to re-run: existing data for the seeded org is left in place;
 * duplicate employees are skipped.
 */

/* eslint-disable */
// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hash(pw: string) {
    return bcrypt.hash(pw, 12);
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

function daysFromNow(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🌱 Starting seed...\n');

    // ── 1. Upsert the demo organisation ──────────────────────────────────────
    const ORG_EMAIL = 'admin@acme.com';
    const ORG_NAME  = 'Acme Corp';
    const ADMIN_PW  = 'password123';

    let org = await (prisma.organization as any).findUnique({
        where: { email: ORG_EMAIL },
    });

    if (!org) {
        org = await (prisma.organization as any).create({
            data: {
                name:  ORG_NAME,
                email: ORG_EMAIL,
                // passwordHash removed from Organization — credentials live on User only.
            },
        });
        console.log(`✅ Created org: ${org.name} (${org.id})`);
    } else {
        console.log(`ℹ️  Org already exists: ${org.name} (${org.id})`);
    }

    // ── 2. Upsert admin User ──────────────────────────────────────────────────
    let adminUser = await (prisma.user as any).findUnique({ where: { email: ORG_EMAIL } });
    if (!adminUser) {
        const pwHash = await hash(ADMIN_PW);
        adminUser = await (prisma.user as any).create({
            data: {
                orgId:        org.id,
                email:        ORG_EMAIL,
                passwordHash: pwHash,
                role:         'ADMIN',
                tokenVersion: 0,
                isActive:     true,
            },
        });
        console.log(`✅ Created admin user: ${adminUser.email}`);
    } else {
        console.log(`ℹ️  Admin user already exists: ${adminUser.email}`);
    }

    // ── 3. Employees + their User accounts ───────────────────────────────────
    const EMPLOYEES = [
        {
            name:       'Alice Chen',
            email:      'alice@acme.com',
            jobTitle:   'Engineer',
            department: 'Engineering',
            skills:     ['TypeScript', 'React', 'Node.js'],
            pw:         'alice-temp-pw',
        },
        {
            name:       'Bob Martinez',
            email:      'bob@acme.com',
            jobTitle:   'Designer',
            department: 'Design',
            skills:     ['Figma', 'CSS', 'UX Research'],
            pw:         'bob-temp-pw',
        },
        {
            name:       'Charlie Park',
            email:      'charlie@acme.com',
            jobTitle:   'Manager',
            department: 'Operations',
            skills:     ['Leadership', 'Agile', 'SQL'],
            pw:         'charlie-temp-pw',
        },
        {
            name:       'Diana Okonkwo',
            email:      'diana@acme.com',
            jobTitle:   'Data Scientist',
            department: 'AI',
            skills:     ['Python', 'Machine Learning', 'TensorFlow'],
            pw:         'diana-temp-pw',
        },
        {
            name:       'Ethan Brooks',
            email:      'ethan@acme.com',
            jobTitle:   'DevOps Engineer',
            department: 'Infrastructure',
            skills:     ['Docker', 'Kubernetes', 'AWS'],
            pw:         'ethan-temp-pw',
        },
    ];

    const employeeMap: Record<string, string> = {}; // email → employee.id

    for (const emp of EMPLOYEES) {
        const existing = await (prisma.employee as any).findFirst({
            where: { orgId: org.id, email: emp.email },
        });

        if (existing) {
            console.log(`ℹ️  Employee already exists: ${emp.name}`);
            employeeMap[emp.email] = existing.id;
            continue;
        }

        const pwHash = await hash(emp.pw);

        const employee = await (prisma.employee as any).create({
            data: {
                orgId:        org.id,
                name:         emp.name,
                email:        emp.email,
                passwordHash: pwHash,
                jobTitle:     emp.jobTitle,
                department:   emp.department,
                skills:       emp.skills,
            },
        });
        employeeMap[emp.email] = employee.id;

        // Create User account for each employee
        const existingUser = await (prisma.user as any).findUnique({ where: { email: emp.email } });
        if (!existingUser) {
            await (prisma.user as any).create({
                data: {
                    orgId:        org.id,
                    employeeId:   employee.id,
                    email:        emp.email,
                    passwordHash: pwHash,
                    role:         'EMPLOYEE',
                    tokenVersion: 0,
                    isActive:     true,
                },
            });
        }

        console.log(`✅ Created employee: ${emp.name} (${employee.id})`);
    }

    // ── 4. Tasks ──────────────────────────────────────────────────────────────
    const TASKS = [
        // Completed tasks (drive completion rate up)
        {
            title:          'Implement JWT refresh token rotation',
            description:    'Add refresh token rotation to the auth service with httpOnly cookies.',
            assignedTo:     employeeMap['alice@acme.com'],
            priority:       'high',
            status:         'COMPLETED',
            complexityScore: 4,
            requiredSkills: ['TypeScript', 'Node.js'],
            dueDate:        daysAgo(10),
            completedAt:    daysAgo(8),
        },
        {
            title:          'Design onboarding flow mockups',
            description:    'Create high-fidelity Figma mockups for the new employee onboarding screen.',
            assignedTo:     employeeMap['bob@acme.com'],
            priority:       'medium',
            status:         'COMPLETED',
            complexityScore: 3,
            requiredSkills: ['Figma', 'UX Research'],
            dueDate:        daysAgo(15),
            completedAt:    daysAgo(12),
        },
        {
            title:          'Set up Kubernetes staging cluster',
            description:    'Provision and configure a staging K8s cluster on AWS EKS.',
            assignedTo:     employeeMap['ethan@acme.com'],
            priority:       'high',
            status:         'COMPLETED',
            complexityScore: 5,
            requiredSkills: ['Kubernetes', 'AWS'],
            dueDate:        daysAgo(20),
            completedAt:    daysAgo(18),
        },
        {
            title:          'Build employee performance dashboard',
            description:    'Create the React dashboard with analytics charts using recharts.',
            assignedTo:     employeeMap['alice@acme.com'],
            priority:       'high',
            status:         'COMPLETED',
            complexityScore: 4,
            requiredSkills: ['TypeScript', 'React'],
            dueDate:        daysAgo(5),
            completedAt:    daysAgo(3),
        },
        {
            title:          'Q1 sprint retrospective report',
            description:    'Document outcomes, blockers, and action items from Q1 sprints.',
            assignedTo:     employeeMap['charlie@acme.com'],
            priority:       'low',
            status:         'COMPLETED',
            complexityScore: 2,
            requiredSkills: ['Agile'],
            dueDate:        daysAgo(3),
            completedAt:    daysAgo(2),
        },
        // In-progress tasks
        {
            title:          'Train ML model for task scoring',
            description:    'Fine-tune the scoring model on historical completion data.',
            assignedTo:     employeeMap['diana@acme.com'],
            priority:       'high',
            status:         'IN_PROGRESS',
            complexityScore: 5,
            requiredSkills: ['Python', 'Machine Learning'],
            dueDate:        daysFromNow(7),
        },
        {
            title:          'Migrate CI/CD pipeline to GitHub Actions',
            description:    'Replace Jenkins with GitHub Actions workflows for all services.',
            assignedTo:     employeeMap['ethan@acme.com'],
            priority:       'medium',
            status:         'IN_PROGRESS',
            complexityScore: 3,
            requiredSkills: ['Docker', 'AWS'],
            dueDate:        daysFromNow(5),
        },
        {
            title:          'Redesign task board UI',
            description:    'Update the Kanban board with drag-and-drop and new colour system.',
            assignedTo:     employeeMap['bob@acme.com'],
            priority:       'medium',
            status:         'IN_PROGRESS',
            complexityScore: 3,
            requiredSkills: ['Figma', 'CSS'],
            dueDate:        daysFromNow(10),
        },
        // Assigned (not started) tasks
        {
            title:          'Add rate limiting to all public API endpoints',
            description:    'Implement per-IP and per-user rate limits using Redis.',
            assignedTo:     employeeMap['alice@acme.com'],
            priority:       'high',
            status:         'ASSIGNED',
            complexityScore: 3,
            requiredSkills: ['Node.js', 'TypeScript'],
            dueDate:        daysFromNow(14),
        },
        {
            title:          'Write SQL optimisation report',
            description:    'Identify slow queries from query logs and recommend indexes.',
            assignedTo:     employeeMap['charlie@acme.com'],
            priority:       'medium',
            status:         'ASSIGNED',
            complexityScore: 3,
            requiredSkills: ['SQL'],
            dueDate:        daysFromNow(21),
        },
        {
            title:          'Explore vector embedding for skill matching',
            description:    'Research and prototype using OpenAI embeddings for matching tasks to employees.',
            assignedTo:     employeeMap['diana@acme.com'],
            priority:       'low',
            status:         'ASSIGNED',
            complexityScore: 4,
            requiredSkills: ['Python', 'Machine Learning'],
            dueDate:        daysFromNow(30),
        },
        {
            title:          'Set up log aggregation with CloudWatch',
            description:    'Centralise application logs from all services into CloudWatch Logs.',
            assignedTo:     employeeMap['ethan@acme.com'],
            priority:       'low',
            status:         'ASSIGNED',
            complexityScore: 2,
            requiredSkills: ['AWS'],
            dueDate:        daysFromNow(28),
        },
    ];

    let taskCount = 0;
    for (const task of TASKS) {
        const existing = await (prisma.task as any).findFirst({
            where: { orgId: org.id, title: task.title },
        });
        if (existing) {
            console.log(`ℹ️  Task already exists: ${task.title}`);
            continue;
        }

        await (prisma.task as any).create({
            data: {
                orgId:          org.id,
                title:          task.title,
                description:    task.description,
                assignedTo:     task.assignedTo,
                priority:       task.priority,
                status:         task.status,
                complexityScore: task.complexityScore,
                requiredSkills: task.requiredSkills,
                dueDate:        task.dueDate,
                completedAt:    task.completedAt ?? null,
            },
        });
        taskCount++;
        console.log(`✅ Created task: "${task.title}" [${task.status}]`);
    }

    // ── 5. Performance logs ───────────────────────────────────────────────────
    const PERF_LOGS = [
        { email: 'alice@acme.com',   score: 88.50, completionRate: 0.90, onTimeRate: 0.85, avgComplexity: 4.0 },
        { email: 'bob@acme.com',     score: 76.25, completionRate: 0.80, onTimeRate: 0.75, avgComplexity: 3.0 },
        { email: 'charlie@acme.com', score: 82.00, completionRate: 0.85, onTimeRate: 0.82, avgComplexity: 2.5 },
        { email: 'diana@acme.com',   score: 91.00, completionRate: 0.95, onTimeRate: 0.90, avgComplexity: 4.5 },
        { email: 'ethan@acme.com',   score: 79.75, completionRate: 0.82, onTimeRate: 0.78, avgComplexity: 3.5 },
    ];

    for (const perf of PERF_LOGS) {
        const empId = employeeMap[perf.email];
        if (!empId) continue;

        const existing = await (prisma.performanceLog as any).findFirst({
            where: { orgId: org.id, employeeId: empId },
        });
        if (existing) {
            console.log(`ℹ️  Performance log already exists for ${perf.email}`);
            continue;
        }

        await (prisma.performanceLog as any).create({
            data: {
                orgId:          org.id,
                employeeId:     empId,
                score:          perf.score,
                completionRate: perf.completionRate,
                onTimeRate:     perf.onTimeRate,
                avgComplexity:  perf.avgComplexity,
            },
        });
        console.log(`✅ Created performance log for ${perf.email}: score ${perf.score}`);
    }

    console.log('\n🎉 Seed complete!\n');
    console.log('── Summary ──────────────────────────────────');
    console.log(`Org:       ${ORG_NAME}`);
    console.log(`Admin:     ${ORG_EMAIL} / ${ADMIN_PW}`);
    console.log(`Employees: ${EMPLOYEES.length}`);
    console.log(`Tasks:     ${TASKS.length} (5 completed, 3 in_progress, 4 assigned)`);
    console.log(`Perf logs: ${PERF_LOGS.length}`);
    console.log('─────────────────────────────────────────────\n');
}

// ── Tenant 2: Orion Ventures ─────────────────────────────────────────────────

async function seedOrionVentures() {
    const ORG_EMAIL = 'admin@orion.io';
    const ORG_NAME  = 'Orion Ventures';
    const ADMIN_PW  = 'Orion@1234';

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏢 Seeding Tenant 2: Orion Ventures\n');

    // Skip if org already exists
    const existingOrg = await (prisma.organization as any).findUnique({ where: { email: ORG_EMAIL } });
    if (existingOrg) {
        console.log(`ℹ️  Orion Ventures already seeded — skipping.`);
        return;
    }

    // 1. Org
    const org = await (prisma.organization as any).create({
        data: { name: ORG_NAME, email: ORG_EMAIL },
    });
    console.log(`✅ Org: ${org.name} (${org.id})`);

    // 2. Admin user
    const adminHash = await hash(ADMIN_PW);
    await (prisma.user as any).create({
        data: {
            orgId: org.id, email: ORG_EMAIL,
            passwordHash: adminHash, role: 'ADMIN',
            tokenVersion: 0, isActive: true,
        },
    });
    console.log(`✅ Admin: ${ORG_EMAIL} / ${ADMIN_PW}`);

    // 3. Employees
    const EMP_DEFS = [
        { name: 'Nina Osei',       email: 'nina@orion.io',    pw: 'Nina@123',
          jobTitle: 'Full Stack Engineer',  department: 'Engineering',
          skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
          wallet: '0x' + 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' },
        { name: 'Rafael Torres',   email: 'rafael@orion.io',  pw: 'Rafael@123',
          jobTitle: 'Backend Engineer',     department: 'Engineering',
          skills: ['Node.js', 'REST APIs', 'Docker', 'PostgreSQL'],
          wallet: '0x' + 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3' },
        { name: 'Yuki Tanaka',     email: 'yuki@orion.io',    pw: 'Yuki@123',
          jobTitle: 'Product Designer',     department: 'Design',
          skills: ['Figma', 'UX Research', 'Prototyping', 'CSS'],
          wallet: '0x' + 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' },
        { name: 'Aisha Nkemdirim', email: 'aisha@orion.io',   pw: 'Aisha@123',
          jobTitle: 'Data Analyst',         department: 'Data',
          skills: ['Python', 'SQL', 'Pandas', 'Tableau'],
          wallet: '0x' + 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5' },
        { name: 'Carlos Reyes',    email: 'carlos@orion.io',  pw: 'Carlos@123',
          jobTitle: 'DevOps Engineer',      department: 'DevOps',
          skills: ['Docker', 'Kubernetes', 'AWS', 'CI/CD', 'Terraform'],
          wallet: '0x' + 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6' },
    ];

    const empMap: Record<string, string> = {};
    for (const def of EMP_DEFS) {
        const pwHash = await hash(def.pw);
        const emp = await (prisma.employee as any).create({
            data: {
                orgId: org.id, name: def.name, email: def.email,
                passwordHash: pwHash, jobTitle: def.jobTitle,
                department: def.department, skills: def.skills,
                walletAddress: def.wallet, isActive: true,
            },
        });
        empMap[def.email] = emp.id;
        await (prisma.user as any).create({
            data: {
                orgId: org.id, employeeId: emp.id, email: def.email,
                passwordHash: pwHash, role: 'EMPLOYEE',
                tokenVersion: 0, isActive: true,
            },
        });
        console.log(`  👤 ${emp.name} (${def.jobTitle} · ${def.department})`);
    }

    // 4. Tasks — uppercase enum values (TaskStatus migration applied)
    const now = () => new Date();
    const dAgo  = (n: number) => { const d = now(); d.setDate(d.getDate() - n); return d; };
    const dFwd  = (n: number) => { const d = now(); d.setDate(d.getDate() + n); return d; };

    const TASKS = [
        // COMPLETED
        { title: 'Bootstrap Next.js monorepo', assignedTo: empMap['nina@orion.io'],
          priority: 'high', status: 'COMPLETED', complexityScore: 3,
          requiredSkills: ['TypeScript', 'React'],
          dueDate: dAgo(20), completedAt: dAgo(18),
          description: 'Set up a Turborepo monorepo with shared UI packages and Next.js apps.' },
        { title: 'Design brand identity system', assignedTo: empMap['yuki@orion.io'],
          priority: 'high', status: 'COMPLETED', complexityScore: 4,
          requiredSkills: ['Figma', 'Prototyping'],
          dueDate: dAgo(18), completedAt: dAgo(15),
          description: 'Define logo, colour palette, typography, and icon system in Figma.' },
        { title: 'Build REST API for user management', assignedTo: empMap['rafael@orion.io'],
          priority: 'high', status: 'COMPLETED', complexityScore: 4,
          requiredSkills: ['Node.js', 'REST APIs', 'PostgreSQL'],
          dueDate: dAgo(14), completedAt: dAgo(12),
          description: 'CRUD endpoints for users, roles, and permissions with JWT auth.' },
        { title: 'Provision AWS ECS cluster', assignedTo: empMap['carlos@orion.io'],
          priority: 'high', status: 'COMPLETED', complexityScore: 4,
          requiredSkills: ['AWS', 'Docker', 'Terraform'],
          dueDate: dAgo(16), completedAt: dAgo(13),
          description: 'Deploy containerised services to ECS Fargate with ALB and auto-scaling.' },
        { title: 'Sales funnel data pipeline', assignedTo: empMap['aisha@orion.io'],
          priority: 'medium', status: 'COMPLETED', complexityScore: 3,
          requiredSkills: ['Python', 'SQL', 'Pandas'],
          dueDate: dAgo(10), completedAt: dAgo(8),
          description: 'ETL pipeline that ingests CRM exports and loads cleaned data into Postgres.' },
        { title: 'Implement dark mode toggle', assignedTo: empMap['nina@orion.io'],
          priority: 'low', status: 'COMPLETED', complexityScore: 2,
          requiredSkills: ['React', 'CSS'],
          dueDate: dAgo(7), completedAt: dAgo(5),
          description: 'System-aware dark/light mode with Tailwind CSS and localStorage persist.' },
        { title: 'Set up GitHub Actions CI pipeline', assignedTo: empMap['carlos@orion.io'],
          priority: 'medium', status: 'COMPLETED', complexityScore: 3,
          requiredSkills: ['CI/CD', 'Docker'],
          dueDate: dAgo(9), completedAt: dAgo(7),
          description: 'Lint, test, and build on every PR; Docker image push on main.' },
        // IN_PROGRESS
        { title: 'Build analytics dashboard', assignedTo: empMap['aisha@orion.io'],
          priority: 'high', status: 'IN_PROGRESS', complexityScore: 4,
          requiredSkills: ['Python', 'SQL', 'Tableau'],
          dueDate: dFwd(6),
          description: 'Interactive Tableau + custom charts dashboard for executive KPIs.' },
        { title: 'Refactor auth to refresh-token rotation', assignedTo: empMap['rafael@orion.io'],
          priority: 'high', status: 'IN_PROGRESS', complexityScore: 4,
          requiredSkills: ['Node.js', 'REST APIs', 'Docker'],
          dueDate: dFwd(4),
          description: 'Replace long-lived JWTs with short-lived access + rotating refresh tokens.' },
        { title: 'User research: onboarding pain points', assignedTo: empMap['yuki@orion.io'],
          priority: 'medium', status: 'IN_PROGRESS', complexityScore: 3,
          requiredSkills: ['UX Research', 'Figma'],
          dueDate: dFwd(8),
          description: 'Conduct 6 user interviews and synthesise findings into a Figma board.' },
        // ASSIGNED
        { title: 'Add Kubernetes horizontal pod autoscaler', assignedTo: empMap['carlos@orion.io'],
          priority: 'medium', status: 'ASSIGNED', complexityScore: 3,
          requiredSkills: ['Kubernetes', 'AWS'],
          dueDate: dFwd(18),
          description: 'Configure HPA based on CPU and custom RPS metrics for all deployments.' },
        { title: 'Write unit tests for API layer', assignedTo: empMap['nina@orion.io'],
          priority: 'medium', status: 'ASSIGNED', complexityScore: 2,
          requiredSkills: ['TypeScript', 'Node.js'],
          dueDate: dFwd(15),
          description: 'Vitest unit tests achieving >80% coverage on all service functions.' },
        { title: 'Churn prediction model v1', assignedTo: empMap['aisha@orion.io'],
          priority: 'high', status: 'ASSIGNED', complexityScore: 5,
          requiredSkills: ['Python', 'Pandas', 'SQL'],
          dueDate: dFwd(25),
          description: 'Train a logistic regression churn model on historical subscription data.' },
    ];

    const completedTaskIds: string[] = [];
    for (const t of TASKS) {
        const task = await (prisma.task as any).create({
            data: {
                orgId: org.id, title: t.title, description: t.description,
                assignedTo: t.assignedTo, priority: t.priority, status: t.status,
                complexityScore: t.complexityScore, requiredSkills: t.requiredSkills,
                dueDate: t.dueDate, completedAt: (t as any).completedAt ?? null,
                isActive: true,
            },
        });
        if (t.status === 'COMPLETED') completedTaskIds.push(task.id);
        const icon = t.status === 'COMPLETED' ? '✅' : t.status === 'IN_PROGRESS' ? '🔄' : '📋';
        console.log(`  ${icon} [${t.status}] "${t.title}"`);
    }

    // 5. Blockchain logs for completed tasks
    const txBases = [
        'f3a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
        'a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3',
        'b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
        'c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
        'd5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
        'e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
        'f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8',
    ];
    for (let i = 0; i < completedTaskIds.length; i++) {
        await (prisma.blockchainLog as any).create({
            data: {
                orgId: org.id, taskId: completedTaskIds[i],
                txHash: `0x${txBases[i % txBases.length]}`,
                eventType: 'task_completed',
            },
        });
    }
    console.log(`  ⛓️  ${completedTaskIds.length} blockchain logs created`);

    // 6. Performance logs — flat columns, 4 entries per employee (trend history)
    // NOTE: uses correct flat columns (no breakdown JSONB — dropped in migration 006)
    const dAgoH = (n: number, h = 0) => { const d = dAgo(n); d.setHours(d.getHours() - h); return d; };
    const PERF: Array<{ email: string; entries: Array<{ daysBack: number; score: number; completionRate: number; onTimeRate: number; avgComplexity: number }> }> = [
        { email: 'nina@orion.io', entries: [
            { daysBack: 21, score: 79.0, completionRate: 0.82, onTimeRate: 0.78, avgComplexity: 3.2 },
            { daysBack: 14, score: 82.5, completionRate: 0.85, onTimeRate: 0.81, avgComplexity: 3.3 },
            { daysBack: 7,  score: 85.0, completionRate: 0.87, onTimeRate: 0.84, avgComplexity: 3.5 },
            { daysBack: 2,  score: 87.3, completionRate: 0.89, onTimeRate: 0.86, avgComplexity: 3.6 },
        ]},
        { email: 'rafael@orion.io', entries: [
            { daysBack: 21, score: 83.0, completionRate: 0.86, onTimeRate: 0.82, avgComplexity: 3.8 },
            { daysBack: 14, score: 81.5, completionRate: 0.84, onTimeRate: 0.80, avgComplexity: 3.7 },
            { daysBack: 7,  score: 79.0, completionRate: 0.82, onTimeRate: 0.78, avgComplexity: 3.6 },
            { daysBack: 2,  score: 77.2, completionRate: 0.80, onTimeRate: 0.76, avgComplexity: 3.5 },
        ]},
        { email: 'yuki@orion.io', entries: [
            { daysBack: 21, score: 86.0, completionRate: 0.88, onTimeRate: 0.85, avgComplexity: 4.0 },
            { daysBack: 14, score: 87.2, completionRate: 0.89, onTimeRate: 0.86, avgComplexity: 4.1 },
            { daysBack: 7,  score: 88.5, completionRate: 0.90, onTimeRate: 0.87, avgComplexity: 4.0 },
            { daysBack: 2,  score: 89.8, completionRate: 0.91, onTimeRate: 0.88, avgComplexity: 4.2 },
        ]},
        { email: 'aisha@orion.io', entries: [
            { daysBack: 21, score: 74.0, completionRate: 0.78, onTimeRate: 0.73, avgComplexity: 3.0 },
            { daysBack: 14, score: 76.5, completionRate: 0.80, onTimeRate: 0.75, avgComplexity: 3.1 },
            { daysBack: 7,  score: 79.0, completionRate: 0.82, onTimeRate: 0.78, avgComplexity: 3.3 },
            { daysBack: 2,  score: 81.4, completionRate: 0.84, onTimeRate: 0.80, avgComplexity: 3.4 },
        ]},
        { email: 'carlos@orion.io', entries: [
            { daysBack: 21, score: 88.5, completionRate: 0.91, onTimeRate: 0.88, avgComplexity: 4.3 },
            { daysBack: 14, score: 87.0, completionRate: 0.90, onTimeRate: 0.86, avgComplexity: 4.2 },
            { daysBack: 7,  score: 85.5, completionRate: 0.88, onTimeRate: 0.84, avgComplexity: 4.1 },
            { daysBack: 2,  score: 84.0, completionRate: 0.87, onTimeRate: 0.83, avgComplexity: 4.0 },
        ]},
    ];

    for (const p of PERF) {
        const empId = empMap[p.email];
        if (!empId) continue;
        for (const e of p.entries) {
            await (prisma.performanceLog as any).create({
                data: {
                    orgId: org.id, employeeId: empId,
                    score: e.score,
                    completionRate: e.completionRate,
                    onTimeRate: e.onTimeRate,
                    avgComplexity: e.avgComplexity,
                    createdAt: dAgoH(e.daysBack),
                },
            });
        }
        const latest = p.entries[p.entries.length - 1];
        console.log(`  📊 ${p.email}: 4 perf logs (latest score ${latest.score})`);
    }

    console.log('\n── Orion Ventures summary ───────────────────');
    console.log(`  Admin:     ${ORG_EMAIL}  /  ${ADMIN_PW}`);
    console.log(`  Employees: Nina, Rafael, Yuki, Aisha, Carlos`);
    console.log(`  Tasks:     ${TASKS.length}  (✅ 7 COMPLETED · 🔄 3 IN_PROGRESS · 📋 3 ASSIGNED)`);
    console.log(`  Blockchain logs: ${completedTaskIds.length}`);
    console.log(`  Perf logs: 20  (4 per employee over 21 days)`);
    console.log('─────────────────────────────────────────────\n');
}

main()
    .then(() => seedOrionVentures())
    .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
