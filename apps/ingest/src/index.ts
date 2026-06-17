import { Hono } from 'hono';
import type { HonoEnv } from './lib/env.js';
import webhookRoute from './routes/webhook.js';
import healthRoute from './routes/health.js';
import reconcileRoute from './routes/reconcile.js';

const app = new Hono<HonoEnv>();

// Mount sub-apps at their paths
app.route('/webhook/helius', webhookRoute);
app.route('/health', healthRoute);
app.route('/internal/reconcile', reconcileRoute);

export default app;
