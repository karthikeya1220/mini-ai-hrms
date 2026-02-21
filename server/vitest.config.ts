/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Use Node environment — no DOM, no jsdom
        environment: 'node',

        // Glob patterns for test files
        include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],

        // TypeScript-aware without a separate Babel transform
        // Vitest uses esbuild under the hood — no ts-jest needed
        globals: true,

        // Print test file + test name for every result
        reporters: ['verbose'],

        // Coverage configuration (used with `npm run test:coverage`)
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/lib/scoring.ts', 'src/services/ai.service.ts'],
        },
    },
});
