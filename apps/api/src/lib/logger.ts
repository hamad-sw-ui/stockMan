/* Logger structuré JSON minimal (pas de dépendance) — remplace les console.log
 * épars. Enrichi du request-id par le middleware de contexte. */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...data };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};
