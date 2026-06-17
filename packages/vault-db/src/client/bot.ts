/// <reference types="@cloudflare/workers-types" />

import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "../schema/bot-db.js";

/** Drizzle instance backed by a Cloudflare D1 binding. */
export type BotDb = ReturnType<typeof drizzleD1<typeof schema>>;

/** Create a Drizzle instance from a Cloudflare D1 binding. */
export function createBotDb(d1Binding: D1Database): BotDb {
  return drizzleD1(d1Binding, { schema });
}
