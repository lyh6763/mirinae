import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 하위 경로에서도 동작하도록 상대 경로로 빌드한다.
  base: './',
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
  },
});
