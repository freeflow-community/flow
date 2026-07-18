import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pg = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(pg, { schema });
export type DB = typeof db;
export { schema };

export async function closeDb(): Promise<void> {
  await pg.end();
}
