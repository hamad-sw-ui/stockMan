/**
 * La spécification OpenAPI servie est-elle EXHAUSTIVE et cohérente ?
 *  - chaque route réelle du code est documentée (comparaison statique) ;
 *  - operationId uniques, résumés FR présents, sécurité par rôle correcte ;
 *  - le document est servi publiquement sur /api/openapi.json.
 */
import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "../src/lib/openapi";
import {
  createTestContext,
  destroyTestContext,
  TestContext,
} from "./helpers/app";

// Montages de app.ts : quel préfixe pour quel fichier de routes
const MOUNTS: Array<[string, string]> = [
  ["auth.ts", "/api/auth"],
  ["pos.ts", "/api/pos"],
  ["sales.ts", "/api/sales"],
  ["stockOps.ts", "/api/stock"],
  ["products.ts", "/api/products"],
  ["users.ts", "/api/users"],
  ["tenants.ts", "/api/tenants"],
  ["licenses.ts", "/api/licenses"],
  ["reports.ts", "/api/reports"],
  ["notifications.ts", "/api/notifications"],
  ["configs.ts", "/api/configs"],
  ["audit.ts", "/api/audit-logs"],
  ["catalog.ts", "/api"],
];

/** Routes réellement déclarées dans le code (analyse statique des routers). */
function actualRoutes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const [file, mount] of MOUNTS) {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "routes", file),
      "utf8",
    );
    const re = /router\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      let p = `${mount}${m[2] === "/" ? "" : m[2]}`;
      p = p.replace(/:(\w+)/g, "{$1}"); // :id → {id}
      out.push({ method: m[1]!, path: p });
    }
  }
  return out;
}

describe("OpenAPI — exhaustivité", () => {
  it("toutes les routes réelles sont documentées", () => {
    const documented = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const missing = actualRoutes().filter(
      (r) => !documented.has(`${r.method} ${r.path}`),
    );
    expect(
      missing,
      `routes manquantes dans openapi.ts: ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  it("toutes les routes documentées existent dans le code", () => {
    const actual = new Set(actualRoutes().map((r) => `${r.method} ${r.path}`));
    const ghost = ROUTES.filter(
      (r) =>
        !actual.has(`${r.method} ${r.path}`) &&
        !["/"].includes(r.path) &&
        !r.path.includes("health") &&
        !r.path.includes("openapi"),
    );
    expect(
      ghost,
      `routes fantômes dans openapi.ts: ${JSON.stringify(ghost.map((g) => `${g.method} ${g.path}`))}`,
    ).toEqual([]);
  });

  it("document conforme : version, operationId uniques, sécurité par rôle", () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("StockMan");
    const ids = new Set<string>();
    for (const doc of ROUTES) {
      const op = spec.paths[doc.path]?.[doc.method] as
        Record<string, unknown> | undefined;
      expect(op, `${doc.method} ${doc.path} absente des paths`).toBeTruthy();
      const id = op!.operationId as string;
      expect(ids.has(id), `operationId dupliqué : ${id}`).toBe(false);
      ids.add(id);
      expect(typeof op!.summary).toBe("string");
      expect((op!.summary as string).length).toBeGreaterThan(10);
      // Sécurité : PUBLIC → security: [] explicite, sinon bearer requis
      if (doc.role === "PUBLIC") expect(op!.security).toEqual([]);
      else expect(op!.security).toEqual([{ bearerAuth: [] }]);
    }
    expect(ids.size).toBe(ROUTES.length);
  });
});

describe("OpenAPI — service HTTP", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await destroyTestContext(ctx);
  });

  it("GET /api/openapi.json est public et valide", async () => {
    const res = await ctx.agent.get("/api/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toContain("max-age");
    expect(res.body.openapi).toBe("3.0.3");
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(60);
    expect(res.body.paths["/api/sales"].post.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(res.body.paths["/api/auth/login"].post.security).toEqual([]);
  });
});
