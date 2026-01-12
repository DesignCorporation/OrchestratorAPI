import Redis from 'ioredis';
import { Pool } from 'pg';

async function run() {
  const redisUrl = process.env.REDIS_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (!redisUrl || !databaseUrl) {
    console.error('REDIS_URL or DATABASE_URL missing');
    process.exit(1);
  }

  const redis = new Redis(redisUrl);
  const pgPool = new Pool({ connectionString: databaseUrl });

  try {
    await pgPool.query('SELECT 1');
    const redisOk = await redis.ping();
    if (redisOk !== 'PONG') {
      throw new Error('Redis ping failed');
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await pgPool.end();
    await redis.quit();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
