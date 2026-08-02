import { buildApp } from "./app";
import { getEnv } from "./config/env";
import { closePool } from "./config/db";
import { logger } from "./lib/logger";
import { applyMigrations } from "./db/migrations";
import { startScheduler } from "./services/scheduler";

async function main() {
  const env = getEnv();

  // Migrations appliquées au démarrage (chaîne rejouable — voir Phase 1 du plan)
  await applyMigrations();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 API StockMan prête`, { port: env.PORT, env: env.NODE_ENV });
  });

  startScheduler();

  // Arrêt propre (drainage des connexions)
  const shutdown = (signal: string) => {
    logger.info(`Signal ${signal} : arrêt en cours…`);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Démarrage impossible", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
