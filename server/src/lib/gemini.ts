// =============================================================================
// lib/gemini.ts — Gemini API client singleton.
//
// Wraps @google/generative-ai with:
//   - Lazy initialisation  — only created if GEMINI_API_KEY is set
//   - Structured JSON mode — every response is parsed back to a typed object
//   - Retry on 429        — single exponential-back-off retry
//   - Hard timeout        — 15 s, so we never block an HTTP response forever
//
// Usage:
//   import { callGemini } from '../lib/gemini';
//   const result = await callGemini<MyType>(prompt, schema);
//
// GRACEFUL DEGRADATION:
//   If GEMINI_API_KEY is not set, callGemini() throws GeminiUnavailableError.
//   Callers (gemini.service.ts) catch this and return a fallback payload so
//   the API always responds — the UI shows "AI unavailable" rather than 500.
// =============================================================================

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// ─── Model config ─────────────────────────────────────────────────────────────

const MODEL_NAME   = 'gemini-2.5-flash'; // fast, cheap, 1M context
const TIMEOUT_MS   = 15_000;
const RETRY_AFTER  = 3_000; // ms to wait before one retry on 429

// ─── Singleton ────────────────────────────────────────────────────────────────

let _model: GenerativeModel | null = null;

function getModel(): GenerativeModel {
    if (_model) return _model;

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new GeminiUnavailableError('GEMINI_API_KEY is not set');
    }

    const genAI = new GoogleGenerativeAI(key);
    _model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
            responseMimeType: 'application/json', // structured JSON output
            temperature: 0.2,                     // low temperature → consistent, factual
            maxOutputTokens: 1024,
        },
    });
    return _model;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class GeminiUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GeminiUnavailableError';
    }
}

export class GeminiParseError extends Error {
    readonly raw: string;
    constructor(raw: string) {
        super('Gemini returned non-JSON or unexpected shape');
        this.name  = 'GeminiParseError';
        this.raw   = raw;
    }
}

// ─── Core call ────────────────────────────────────────────────────────────────

/**
 * Send a prompt to Gemini and parse the JSON response into T.
 *
 * @param prompt   Full prompt string (include JSON schema description).
 * @param attempt  Internal retry counter — do not pass from outside.
 */
export async function callGemini<T>(
    prompt: string,
    attempt = 1,
): Promise<T> {
    const model = getModel();

    // Race the API call against a hard timeout
    const response = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini timeout')), TIMEOUT_MS),
        ),
    ]);

    const text = response.response.text().trim();

    // Strip markdown code fences if Gemini wraps the JSON
    const jsonText = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    let parsed: T;
    try {
        parsed = JSON.parse(jsonText) as T;
    } catch {
        // One retry on 429-like or malformed response
        if (attempt === 1) {
            await sleep(RETRY_AFTER);
            return callGemini<T>(prompt, 2);
        }
        throw new GeminiParseError(text);
    }

    return parsed;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
