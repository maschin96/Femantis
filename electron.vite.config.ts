import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    plugins: [
      react(),
      {
        name: 'development-csp',
        transformIndexHtml(html, context) {
          return context.server
            ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            : html;
        },
      },
    ],
  },
});
