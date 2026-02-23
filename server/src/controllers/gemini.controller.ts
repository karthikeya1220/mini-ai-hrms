// =============================================================================
// controllers/gemini.controller.ts — HTTP layer for POST /api/ai/analyze
//
// Single endpoint, three analysis types dispatched via `type` field:
//
//   POST /api/ai/analyze
//   Body: { type: 'score' | 'skill-gap' | 'workload', payload: {...} }
//
// Authorization: ADMIN only (analysis output contains org-wide context).
//
// The controller:
//   1. Validates the request body shape with Zod
//   2. Pulls any required DB data to enrich the payload
//   3. Calls the appropriate gemini.service function
//   4. Returns the Gemini analysis JSON
//
// DB enrichment happens HERE (not in the service) because:
//   - gemini.service.ts has zero DB dependencies — pure prompt logic
//   - This controller already has access to authMiddleware's orgId
//   - Makes gemini.service testable without mocking Prisma
// =============================================================================

import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { getRedis, cacheKey } from '../lib/redis';
import {
    analyzeWorkforceScore,
    analyzeSkillGaps,
    predictWorkload,
} from '../services/gemini.service';

// ─── Cache namespace ──────────────────────────────────────────────────────────
// Gemini calls are expensive; cache analysis for 10 minutes per (type, subjectId)
const GEMINI_NS = 'gemini:analyze';
const CACHE_TTL = 600; // 10 minutes

// ─── Request schema ───────────────────────────────────────────────────────────

const AnalyzeScoreBody = z.object({
    type:       z.literal('score'),
    employeeId: z.string().uuid(),
});

const AnalyzeSkillGapBody = z.object({
    type:       z.literal('skill-gap'),
    employeeId: z.string().uuid(),
});

const AnalyzeWorkloadBody = z.object({
    type:       z.literal('workload'),
    employeeId: z.string().uuid(),
});

const AnalyzeBody = z.discriminatedUnion('type', [
    AnalyzeScoreBody,
    AnalyzeSkillGapBody,
    AnalyzeWorkloadBody,
]);

// =============================================================================
// POST /api/ai/analyze
// =============================================================================

export async function analyzeHandler(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const orgId = req.user!.orgId;
        const body  = AnalyzeBody.parse(req.body);

        const redis    = getRedis();
        const cacheK   = cacheKey(GEMINI_NS, `${body.type}:${body.employeeId}`);

        // ── Cache read ────────────────────────────────────────────────────────
        if (redis) {
            try {
                const cached = await redis.get(cacheK);
                if (cached) {
                    sendSuccess(res, { ...JSON.parse(cached), cached: true });
                    return;
                }
            } catch { /* ignore cache errors */ }
        }

        // ── Fetch employee (common to all types) ──────────────────────────────
        const employee = await prisma.employee.findFirst({
            where: { id: body.employeeId, orgId },
            select: {
                id: true, name: true, jobTitle: true, skills: true,
                tasks: {
                    select: {
                        status: true, complexityScore: true, priority: true,
                        dueDate: true, completedAt: true, requiredSkills: true,
                        createdAt: true,
                    },
                },
            },
        });
        if (!employee) {
            throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
        }

        let analysis: unknown;

        // ── Dispatch by type ──────────────────────────────────────────────────

        if (body.type === 'score') {
            // Compute breakdown locally (same formula as scoring engine)
            const tasks = employee.tasks;
            const completed = tasks.filter(t => t.status === 'completed');
            const totalAssigned = tasks.length;
            const totalCompleted = completed.length;
            const completionRate = totalAssigned > 0 ? totalCompleted / totalAssigned : 0;
            const completedWithDue = completed.filter(t => t.dueDate !== null);
            const onTime = completedWithDue.filter(
                t => t.completedAt !== null && t.completedAt <= t.dueDate!,
            );
            const onTimeRate = completedWithDue.length > 0 ? onTime.length / completedWithDue.length : 0;
            const avgComplexity = totalAssigned > 0
                ? tasks.reduce((s, t) => s + t.complexityScore, 0) / totalAssigned
                : 0;
            const rawScore = totalAssigned === 0 ? null
                : Math.round(((completionRate * 40) + (onTimeRate * 35) + ((avgComplexity / 5) * 25)) * 10) / 10;

            const scoreToGrade = (s: number) =>
                s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : 'D';

            // Trend via performance logs
            const trend = await computeTrendForEmployee(orgId, body.employeeId);

            analysis = await analyzeWorkforceScore({
                employeeName: employee.name,
                score:  rawScore,
                grade:  rawScore !== null ? scoreToGrade(rawScore) : null,
                breakdown: rawScore !== null ? {
                    completionRate:     Math.round(completionRate * 1000) / 1000,
                    onTimeRate:         Math.round(onTimeRate * 1000) / 1000,
                    avgComplexity:      Math.round(avgComplexity * 100) / 100,
                    totalTasksAssigned: totalAssigned,
                    totalCompleted,
                    totalOnTime:        onTime.length,
                } : null,
                trend,
            });

        } else if (body.type === 'skill-gap') {
            // Build required skills from tasks assigned to same-role employees
            const sameRoleIds = employee.jobTitle
                ? (await prisma.employee.findMany({
                    where: { orgId, jobTitle: employee.jobTitle },
                    select: { id: true },
                })).map(e => e.id)
                : [employee.id];

            const roleTasks = await prisma.task.findMany({
                where: { orgId, assignedTo: { in: sameRoleIds } },
                select: { requiredSkills: true },
            });

            const requiredSet = new Set(
                roleTasks.flatMap(t => t.requiredSkills).map(s => s.toLowerCase()),
            );
            const currentSet = new Set(employee.skills.map(s => s.toLowerCase()));
            const gapSkills  = [...requiredSet].filter(s => !currentSet.has(s));
            const coverageRate = requiredSet.size > 0
                ? (requiredSet.size - gapSkills.length) / requiredSet.size
                : 1;

            analysis = await analyzeSkillGaps({
                employeeName:   employee.name,
                jobTitle:       employee.jobTitle,
                currentSkills:  employee.skills,
                requiredSkills: [...requiredSet],
                gapSkills,
                coverageRate,
            });

        } else {
            // workload
            const activeTasks = employee.tasks.filter(t => t.status !== 'completed');
            const priorities  = { low: 0, medium: 0, high: 0 };
            for (const t of activeTasks) {
                const p = t.priority as 'low' | 'medium' | 'high';
                if (p in priorities) priorities[p]++;
            }
            const avgComplexity = activeTasks.length > 0
                ? activeTasks.reduce((s, t) => s + t.complexityScore, 0) / activeTasks.length
                : 0;

            const trend = await computeTrendForEmployee(orgId, body.employeeId);
            const perfLog = await prisma.performanceLog.findFirst({
                where: { orgId, employeeId: body.employeeId, score: { not: null } },
                orderBy: { computedAt: 'desc' },
                select: { score: true },
            });

            // Weekly completions: count completed tasks per week for last 4 weeks
            const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
            const recentCompleted = employee.tasks.filter(
                t => t.status === 'completed' && t.completedAt && t.completedAt >= fourWeeksAgo,
            );
            const weeklyCompletions = [0, 1, 2, 3].map(weekIdx => {
                const start = new Date(Date.now() - (weekIdx + 1) * 7 * 24 * 60 * 60 * 1000);
                const end   = new Date(Date.now() - weekIdx * 7 * 24 * 60 * 60 * 1000);
                return recentCompleted.filter(
                    t => t.completedAt! >= start && t.completedAt! < end,
                ).length;
            }).reverse();

            analysis = await predictWorkload({
                employeeName:     employee.name,
                activeTaskCount:  activeTasks.length,
                activePriorities: priorities,
                avgComplexity,
                trend,
                score: perfLog?.score ? Number(perfLog.score) : null,
                weeklyCompletions,
            });
        }

        // ── Cache write ───────────────────────────────────────────────────────
        if (redis) {
            redis.set(cacheK, JSON.stringify(analysis), 'EX', CACHE_TTL).catch(() => {});
        }

        sendSuccess(res, { type: body.type, employeeId: body.employeeId, analysis, cached: false });
    } catch (err) {
        next(err);
    }
}

// ─── Internal: trend helper (mirrors ai.service computeTrend) ─────────────────

async function computeTrendForEmployee(
    orgId: string,
    employeeId: string,
): Promise<'improving' | 'declining' | 'stable' | 'insufficient_data'> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const logs = await prisma.performanceLog.findMany({
        where: {
            orgId,
            employeeId,
            score:      { not: null },
            computedAt: { gte: d60 },
        },
        select: { score: true, computedAt: true },
        orderBy: { computedAt: 'asc' },
    });

    const recent   = logs.filter(l => l.computedAt >= d30);
    const previous = logs.filter(l => l.computedAt < d30);

    if (!recent.length || !previous.length) return 'insufficient_data';

    const avg = (arr: typeof logs) =>
        arr.reduce((s, l) => s + Number(l.score), 0) / arr.length;

    const delta = avg(recent) - avg(previous);
    if (delta >= 1)  return 'improving';
    if (delta <= -1) return 'declining';
    return 'stable';
}
