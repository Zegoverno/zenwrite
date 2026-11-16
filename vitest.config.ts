import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['core/**/*.test.ts', 'ui/src/**/*.test.ts', 'mcp/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 30_000 },
});
