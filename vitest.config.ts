import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/types/**'],
    },
  },
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./test/__mocks__/vscode.ts', import.meta.url)),
    },
  },
});
