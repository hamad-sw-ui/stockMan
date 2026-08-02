import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { getEnv } from './env';
import { logger } from '../lib/logger';

/**
 * NUMERIC (OID 1700) renvoyé comme NUMBER et non comme string :
 * les montants FCFA à 2 décimales restent exactement représentables en float64
 * (max NUMERIC(15,2) ≈ 10^13 ≪ 2^53) et l'API JSON est cohérente entre
 * Postgres réel et pg-mem.
 */
types.setTypeParser(1700, (v: string) => (v === null ? v : parseFloat(v)));

/**
 * Registre de pool — `setPool()` permet aux tests d'injecter pg-mem sans
 * modifier le code métier.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 20 });
    pool.on('error', (err) => logger.error('Erreur pool PostgreSQL', { message: err.message }));
  }
  return pool;
}

/** Remplace le pool (tests uniquement). Retourne l'ancien pour restauration. */
export function setPool(p: Pool | undefined): Pool | undefined {
  const old = pool;
  pool = p;
  return old;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/** Exécute `fn` dans une transaction (BEGIN/COMMIT/ROLLBACK) sur UN client
 *  dédié — garantit l'atomicité des opérations multi-étapes. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* noop */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
