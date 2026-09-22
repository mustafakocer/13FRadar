import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  // The contact address on the legal pages and in the footer, from the
  // build environment (CONTACT_EMAIL); a placeholder until it is set.
  define: { __CONTACT_EMAIL__: JSON.stringify(process.env.CONTACT_EMAIL || '') },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
  // The SSR bundle is imported by a Vercel function outside client/, so it
  // must not depend on client/node_modules resolution at runtime.
  ssr: { noExternal: true },
  // public/ is copied by the client build only; the SSR bundle reads it from
  // the repo (api/_lib/ssr/routes.js) so it must not be duplicated.
  ...(isSsrBuild ? { publicDir: false } : {}),
}));
