import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import Redis from 'ioredis';
import argon2 from 'argon2';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

async function main() {
  const sqlPath = resolve(requiredEnv('SEED_PATH'));
  const seedPassword = requiredEnv('RIDEX_SEED_PASSWORD');
  const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });
  const sql = readFileSync(sqlPath, 'utf8').replaceAll('__RIDEX_DEV_PASSWORD_HASH__', passwordHash);

  const client = new Client({ connectionString: requiredEnv('DATABASE_URL') });
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query<{
    driver_id: string;
    lon: number;
    lat: number;
  }>(`
    SELECT dl.driver_id,
           ST_X(dl.location::geometry) AS lon,
           ST_Y(dl.location::geometry) AS lat
      FROM driver_locations dl
      JOIN drivers d ON d.user_id = dl.driver_id
     WHERE d.status = 'online'
  `);
  await client.end();

  const redis = new Redis(requiredEnv('REDIS_URL'));
  for (const row of rows) {
    await redis.geoadd('driver:online', row.lon, row.lat, row.driver_id);
  }
  await redis.quit();

  console.log(`seed loaded from ${sqlPath}`);
  console.log(`seeded ${rows.length} online drivers into Redis GEO index`);
  console.log('seed users use the RIDEX_SEED_PASSWORD supplied by the environment');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
