#!/usr/bin/env node
import { closePool } from "../config/db";
import { logger } from "../lib/logger";
import { applyMigrations, migrationStatus } from "./migrations";

/**
 * CLI : `npm run migrate` (ts-node/tsx en dev, `node dist/db/migrate.js` en prod).
 * Options : `--status` affiche l'état sans appliquer.
 */
async function main() {
  const statusOnly = process.argv.includes("--status");
  if (statusOnly) {
    const rows = await migrationStatus();
    for (const r of rows) logger.info(`${r.applied ? "[x]" : "[ ]"} ${r.name}`);
    return;
  }
  const { applied, skipped } = await applyMigrations();
  logger.info("Migrations terminées", {
    applied: applied.length,
    skipped: skipped.length,
  });
}

main()
  .catch((err) => {
    logger.error("Migration échouée", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  })
  .finally(() => closePool());
