import { Hono } from 'hono';

type Bindings = {
  vault_db: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Auth middleware is not needed on this Worker. It is reached only via
// service binding from vault-operator, which already validates
// OPERATOR_TOKEN. See docs/specs/01-architecture.md §"Operator Worker
// trust model".

// The real handler must validate the disbursement request body, persist
// the disbursement row in vault_db, and enqueue the on-chain transfer
// for operator approval. The mock returns `{ ok: true }`.
app.post('/api/disbursements', (c) => {
  return c.json({ ok: true }, 200);
});

app.all('*', (c) => {
  return c.notFound();
});

export default app;
