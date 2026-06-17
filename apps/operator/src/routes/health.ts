import { Hono } from 'hono';
import type { Env } from '../lib/env';

const health = new Hono<{ Bindings: Env }>();

health.get('/', (c) => {
  return c.json({ status: 'ok' }, 200);
});

export { health as healthRoute };
