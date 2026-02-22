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
        const pwHash = await hash(ADMIN_PW);
        org = await (prisma.organization as any).create({
            data: {
                name:         ORG_NAME,
                email:        ORG_EMAIL,
                passwordHash: pwHash,
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
            role:       'Engineer',
            department: 'Engineering',
            skills:     ['TypeScript', 'React', 'Node.js'],
            pw:         'alice-temp-pw',
        },
        {
            name:       'Bob Martinez',
            email:      'bob@acme.com',
            role:       'Designer',
            department: 'Design',
            skills:     ['Figma', 'CSS', 'UX Research'],
            pw:         'bob-temp-pw',
        },
        {
            name:       'Charlie Park',
            email:      'charlie@acme.com',
            role:       'Manager',
            department: 'Operations',
            skills:     ['Leadership', 'Agile', 'SQL'],
            pw:         'charlie-temp-pw',
        },
        {
            name:       'Diana Okonkwo',
            email:      'diana@acme.com',
            role:       'Data Scientist',
            department: 'AI',
            skills:     ['Python', 'Machine Learning', 'TensorFlow'],
            pw:         'diana-temp-pw',
        },
        {
            name:       'Ethan Brooks',
            email:      'ethan@acme.com',
            role:       'DevOps Engineer',
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
                role:         emp.role,
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
            status:         'completed',
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
            status:         'completed',
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
            status:         'completed',
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
            status:         'completed',
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
            status:         'completed',
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
            status:         'in_progress',
            complexityScore: 5,
            requiredSkills: ['Python', 'Machine Learning'],
            dueDate:        daysFromNow(7),
        },
        {
            title:          'Migrate CI/CD pipeline to GitHub Actions',
            description:    'Replace Jenkins with GitHub Actions workflows for all services.',
            assignedTo:     employeeMap['ethan@acme.com'],
            priority:       'medium',
            status:         'in_progress',
            complexityScore: 3,
            requiredSkills: ['Docker', 'AWS'],
            dueDate:        daysFromNow(5),
        },
        {
            title:          'Redesign task board UI',
            description:    'Update the Kanban board with drag-and-drop and new colour system.',
            assignedTo:     employeeMap['bob@acme.com'],
            priority:       'medium',
            status:         'in_progress',
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
            status:         'assigned',
            complexityScore: 3,
            requiredSkills: ['Node.js', 'TypeScript'],
            dueDate:        daysFromNow(14),
        },
        {
            title:          'Write SQL optimisation report',
            description:    'Identify slow queries from query logs and recommend indexes.',
            assignedTo:     employeeMap['charlie@acme.com'],
            priority:       'medium',
            status:         'assigned',
            complexityScore: 3,
            requiredSkills: ['SQL'],
            dueDate:        daysFromNow(21),
        },
        {
            title:          'Explore vector embedding for skill matching',
            description:    'Research and prototype using OpenAI embeddings for matching tasks to employees.',
            assignedTo:     employeeMap['diana@acme.com'],
            priority:       'low',
            status:         'assigned',
            complexityScore: 4,
            requiredSkills: ['Python', 'Machine Learning'],
            dueDate:        daysFromNow(30),
        },
        {
            title:          'Set up log aggregation with CloudWatch',
            description:    'Centralise application logs from all services into CloudWatch Logs.',
            assignedTo:     employeeMap['ethan@acme.com'],
            priority:       'low',
            status:         'assigned',
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
        { email: 'alice@acme.com',   score: 88.50, breakdown: { completionRate: 0.90, onTimeRate: 0.85, avgComplexity: 4.0 } },
        { email: 'bob@acme.com',     score: 76.25, breakdown: { completionRate: 0.80, onTimeRate: 0.75, avgComplexity: 3.0 } },
        { email: 'charlie@acme.com', score: 82.00, breakdown: { completionRate: 0.85, onTimeRate: 0.82, avgComplexity: 2.5 } },
        { email: 'diana@acme.com',   score: 91.00, breakdown: { completionRate: 0.95, onTimeRate: 0.90, avgComplexity: 4.5 } },
        { email: 'ethan@acme.com',   score: 79.75, breakdown: { completionRate: 0.82, onTimeRate: 0.78, avgComplexity: 3.5 } },
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
                orgId:      org.id,
                employeeId: empId,
                score:      perf.score,
                breakdown:  perf.breakdown,
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

main()
    .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
