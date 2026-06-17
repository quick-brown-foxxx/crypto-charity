import { Hono } from 'hono';
import type { Env } from '../lib/env';

const health = new Hono<{ Bindings: Env }>();

health.get('/health', (c) => {
  return c.json({ status: 'ok' }, 200);
});

export default health;
