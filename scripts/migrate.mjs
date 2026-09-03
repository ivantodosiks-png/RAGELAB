/**
 * Applies the SQL files in supabase/migrations in filename order.
 *
 * Every applied file is recorded in `public._ragelab_migrations` with a hash of
 * its contents, so re-running is a no-op and editing an already applied file is
 * reported instead of silently ignored.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status  show what would run
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env'), quiet: true });

const statusOnly = process.argv.includes('--status');
const force = process.argv.includes('--force');

const rawConnectionString =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

/**
 * Supabase hands out URLs with `sslmode=require`, which node-postgres now maps
 * to `verify-full`. Supabase's pooler presents a certificate signed by its own
 * CA, so we drop the query flag and configure TLS explicitly instead.
 */
function sanitizeConnectionString(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('supa');
    return u.toString();
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, '');
  }
}

const connectionString = rawConnectionString ? sanitizeConnectionString(rawConnectionString) : '';

if (!connectionString) {
  console.error(
    'No database connection string. Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env',
  );
  process.exit(1);
}

const migrationsDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No migration files found.');
  process.exit(0);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  // Migrations can create indexes; give them room.
  statement_timeout: 120_000,
});

function hashOf(sql) {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

try {
  await client.connect();
  console.log(`Connected to ${client.host ?? 'database'}`);

  await client.query(`
    create table if not exists public._ragelab_migrations (
      name       text primary key,
      hash       text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query('select name, hash from public._ragelab_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.hash]));

  let pending = 0;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const hash = hashOf(sql);
    const previous = applied.get(file);

    if (previous === hash && !force) {
      console.log(`  = ${file} (already applied)`);
      continue;
    }
    if (previous && previous !== hash && !force) {
      console.warn(
        `  ! ${file} changed since it was applied (stored ${previous}, now ${hash}).\n` +
          '    Add a new migration file instead of editing this one, or re-run with --force.',
      );
      continue;
    }

    pending++;
    if (statusOnly) {
      console.log(`  + ${file} (would apply)`);
      continue;
    }

    console.log(`  + ${file} applying...`);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        `insert into public._ragelab_migrations (name, hash) values ($1, $2)
         on conflict (name) do update set hash = excluded.hash, applied_at = now()`,
        [file, hash],
      );
      await client.query('commit');
      console.log(`  + ${file} done`);
    } catch (err) {
      await client.query('rollback');
      console.error(`  x ${file} failed: ${err.message}`);
      throw err;
    }
  }

  if (pending === 0) console.log('Database is up to date.');
  else if (statusOnly) console.log(`${pending} migration(s) pending.`);
  else console.log(`Applied ${pending} migration(s).`);

  if (!statusOnly) {
    const emails = (process.env.RAGELAB_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length > 0) {
      try {
        let granted = 0;
        for (const email of emails) {
          const result = await client.query(
            `insert into public.staff (profile_id)
             select id from auth.users where lower(email) = $1
             on conflict (profile_id) do nothing`,
            [email],
          );
          granted += result.rowCount ?? 0;
        }
        console.log(`Admin grants from RAGELAB_ADMIN_EMAILS: ${granted} new, ${emails.length} listed.`);
      } catch (err) {
        console.warn('Could not grant admins from RAGELAB_ADMIN_EMAILS:', err.message);
      }
    }
  }
} catch (err) {
  console.error('\nMigration failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
