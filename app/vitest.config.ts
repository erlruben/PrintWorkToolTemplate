import { defineConfig } from 'vitest/config';

// Unit tests only (tests/unit). The browser, role and API checks are scripts
// in tests/ that run against a signed-in test browser or a rolled-back
// database transaction — see tests/README.md.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
