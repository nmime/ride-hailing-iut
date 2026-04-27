import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

async function main() {
  const sqlPath = resolve(process.env.SEED_PATH ?? './db/seed/seed.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log(`seed loaded from ${sqlPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
