import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Un contexte pg-mem par fichier de test : isolation forte, pas de parallélisme inter-fichiers.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
