import { Hono } from 'hono';
import type { HonoEnv } from '../lib/env.js';

const healthRoute = new Hono<HonoEnv>();

healthRoute.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }, 200);
});

export default healthRoute;
