import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({ plugins: [react()], server: { fs: { allow: ['..'] } }, resolve: { alias: [
  { find: /^(.*)\/auth\.jsx$/, replacement: path.resolve('src/__sparktest/mockAuth.jsx') },
  { find: /^(.*)\/lib\/api\.js$/, replacement: path.resolve('src/__sparktest/mockApi.js') },
] } });
