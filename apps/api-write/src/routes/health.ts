import { Hono } from "hono";
import type { Env } from "../lib/env.js";

const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/health", (c) => {
  return c.json({ status: "ok" }, 200);
});

export { healthRoute };
