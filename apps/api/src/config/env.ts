import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Validation stricte de l'environnement au démarrage (corrige SEC-01 :
 * aucun secret de repli — le process refuse de démarrer sans secrets valides).
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.boolean().default(false),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  REFRESH_SECRET: z.string().min(32, 'REFRESH_SECRET doit faire au moins 32 caractères'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(14).default(10),
  LICENSE_GRACE_DAYS: z.coerce.number().int().min(0).default(3),
  MAX_SYNC_AGE_HOURS: z.coerce.number().int().min(1).default(48),
  ENABLE_SCHEDULER: z.coerce.boolean().default(true),
  NOTIF_DRIVER: z.enum(['mock', 'live']).default('mock'),
  AT_API_KEY: z.string().optional(),
  AT_USERNAME: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
  WA_TOKEN: z.string().optional(),
  WA_PHONE_ID: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Charge et valide l'env une seule fois. En contexte de test (`NODE_ENV=test`),
 * des secrets de test sont fournis pour permettre l'exécution hors .env réel. */
export function getEnv(): Env {
  if (cached) return cached;
  const raw = { ...process.env };
  if (raw.NODE_ENV === 'test' || process.env.VITEST) {
    raw.NODE_ENV = 'test';
    raw.JWT_SECRET ||= 'test-secret-access-0123456789abcdef0123456789abcdef';
    raw.REFRESH_SECRET ||= 'test-secret-refresh-0123456789abcdef0123456789abcdef';
    raw.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
    raw.ENABLE_SCHEDULER ||= 'false';
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    // Échec volontairement bruyant : ne jamais tourner avec des secrets invalides.
    console.error(`❌ Configuration invalide, démarrage annulé :\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
