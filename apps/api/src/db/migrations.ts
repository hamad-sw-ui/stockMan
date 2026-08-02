import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPool } from '../config/db';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Runner de migrations versionnées (corrige ARC-03/04/05) :
 *  - chaîne unique `database/migrations/V###__nom.sql` ;
 *  - application en transaction, enregistrement dans `schema_migrations` ;
 *  - idempotente (rejouable) et intègre (échec si un fichier déjà appliqué a changé).
 */

interface MigrationFile {
  version: string;
  name: string;
  file: string;
  checksum: string;
}

/** Localise le dossier des migrations : env explicite, sinon remonte l'arbre
 *  depuis ce fichier (fonctionne en tsx comme en dist/). */
export function locateMigrationsDir(): string {
  const envDir = getEnv().MIGRATIONS_DIR;
  if (envDir && fs.existsSync(envDir)) return envDir;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'database', 'migrations');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Dossier database/migrations introuvable. Définissez MIGRATIONS_DIR.',
  );
}

export function listMigrationFiles(dir?: string): MigrationFile[] {
  const migrationsDir = dir ?? locateMigrationsDir();
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => /^V\d+__.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const version = f.split('__')[0]!;
      return {
        version,
        name: f,
        file: path.join(migrationsDir, f),
        checksum: crypto.createHash('sha256').update(content).digest('hex'),
      };
    });
}

export async function ensureMigrationsTable(): Promise<void> {
  const exists = await getPool().query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  if (exists.rows[0]!.n > 0) return;
  await getPool().query(`
    CREATE TABLE schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

export async function applyMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationsTable();
  const files = listMigrationFiles();
  const applied: string[] = [];
  const skipped: string[] = [];

  const existing = await getPool().query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  const byVersion = new Map(existing.rows.map((r) => [r.version, r.checksum]));

  for (const m of files) {
    const knownChecksum = byVersion.get(m.version);
    if (knownChecksum) {
      if (knownChecksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} modifiée après application (checksum différent). ` +
            'Créez une nouvelle migration plutôt que de modifier un fichier appliqué.',
        );
      }
      skipped.push(m.name);
      continue;
    }
    const sql = fs.readFileSync(m.file, 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1,$2,$3)',
        [m.version, m.name, m.checksum],
      );
      await client.query('COMMIT');
      applied.push(m.name);
      logger.info(`Migration appliquée : ${m.name}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Échec migration ${m.name}`, { message });
      throw new Error(`Migration ${m.name} échouée : ${message}`);
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

/** Utilisé par les tests : applique la chaîne sur le pool courant (pg-mem). */
export async function migrateTestDatabase(): Promise<void> {
  await applyMigrations();
}

export async function migrationStatus(): Promise<
  Array<{ version: string; name: string; applied: boolean }>
> {
  await ensureMigrationsTable();
  const files = listMigrationFiles();
  const existing = await getPool().query<{ version: string }>('SELECT version FROM schema_migrations');
  const set = new Set(existing.rows.map((r) => r.version));
  return files.map((f) => ({ version: f.version, name: f.name, applied: set.has(f.version) }));
}
