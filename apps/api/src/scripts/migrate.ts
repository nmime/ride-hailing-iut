/**
 * Tiny SQL migration runner — not meant to compete with Flyway / Atlas /
 * Alembic, but small enough that the team can defend every line.
 *
 * - Reads ./db/migrations/*.sql in lexical order.
 * - Records applied filenames in the `schema_migrations` table.
 * - Runs each unapplied file inside a single transaction.
 *
 * The team is welcome to swap this out for a real migration tool later;
 * this is here so `pnpm migrate` works on day one.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { Client } from 'pg';

import { requiredEnv } from '../common/env';

async function main() {
  const dir = resolve(requiredEnv('MIGRATIONS_DIR'));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({ connectionString: requiredEnv('DATABASE_URL') });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(rows.map((r) => r.filename));

  for (const f of files) {
    if (applied.has(f)) {
      console.log(`-- skip   ${f}`);
      continue;
    }
    const sql = readFileSync(join(dir, f), 'utf8');
    console.log(`-- apply  ${f}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  await client.end();
  console.log('migrations complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
