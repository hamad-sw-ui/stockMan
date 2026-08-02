import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestContext,
  destroyTestContext,
  TestContext,
} from "./helpers/app";
import {
  applyMigrations,
  listMigrationFiles,
  migrationStatus,
} from "../src/db/migrations";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await destroyTestContext(ctx);
});

describe("Chaîne de migrations V2 (rejouable, appliquée sur schéma réel)", () => {
  it("applique toutes les migrations listées", async () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
    const status = await migrationStatus();
    expect(status.every((s) => s.applied)).toBe(true);
  });

  it("est idempotente : un 2ᵉ passage ne ré-applique rien", async () => {
    const { applied, skipped } = await applyMigrations();
    expect(applied).toEqual([]);
    expect(skipped.length).toBeGreaterThanOrEqual(3);
  });

  it("les tables métier attendues existent", async () => {
    const r = await ctx.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' ORDER BY table_name`,
    );
    const names = r.rows.map((x: { table_name: string }) => x.table_name);
    for (const t of [
      "tenants",
      "users",
      "refresh_tokens",
      "licenses",
      "plans",
      "depots",
      "categories",
      "units",
      "products",
      "product_variants",
      "stock_levels",
      "stock_batches",
      "suppliers",
      "sales",
      "sale_items",
      "sale_returns",
      "stock_receipts",
      "stock_transfers",
      "stock_movements",
      "audit_logs",
      "notifications",
      "notification_settings",
      "system_configs",
      "tenant_configs",
    ]) {
      expect(names, `table manquante : ${t}`).toContain(t);
    }
  });
});
