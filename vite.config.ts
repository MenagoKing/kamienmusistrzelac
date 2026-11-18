import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** In development the API runs inside Vite (one process, one port). Production: server/index.ts. */
function api(): Plugin {
  return {
    name: 'space-rocks-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';
        if (/^\/admin(\/|$|\?|#)/.test(url) && !url.includes('.')) req.url = '/admin.html';
        if (!url.startsWith('/api/') && !url.startsWith('/uploads/') && !/^\/s\/[\w-]+$/.test(url)) return next();
        try {
          const mod = await server.ssrLoadModule('/server/app.ts');
          if (!(await mod.handle(req, res))) next();
        } catch (e) {
          next(e);
        }
      });
      server.httpServer?.once('listening', async () => {
        const auth = await server.ssrLoadModule('/server/auth.ts');
        auth.initAdmin();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The API reads its settings from process.env; pick them up from .env in development too.
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['ADMIN_PASSWORD', 'DATA_DIR']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  return {
    plugins: [react(), api()],
    build: {
      assetsInlineLimit: 0,
      rollupOptions: { input: { main: 'index.html', admin: 'admin.html', privacy: 'privacy.html' } },
    },
    ssr: { external: ['node:sqlite'] },
  };
});
