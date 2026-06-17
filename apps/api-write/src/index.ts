import { Hono } from "hono";
import type { Env } from "./lib/env.js";
import { disbursementsRoute } from "./routes/disbursements.js";
import { healthRoute } from "./routes/health.js";

// Auth middleware is not needed on this Worker. It is reached only via
// service binding from vault-operator, which already validates OPERATOR_TOKEN.
// See docs/specs/01-architecture.md §"Operator Worker trust model".

const app = new Hono<{ Bindings: Env }>();

app.route("/", disbursementsRoute);
app.route("/", healthRoute);

export default app;
