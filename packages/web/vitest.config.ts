import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit tests do not need the production Vite configuration, which reads the
// local Git build identifier. Keeping that out of the test config makes the
// renderer suite runnable in sandboxed and CI environments.
export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
