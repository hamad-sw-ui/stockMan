import { PoolClient } from "pg";
import { query, withTransaction } from "../config/db";
import { writeAudit } from "../lib/audit";

/**
 * D1/D2 — Export & restauration des DONNÉES d'un tenant (docs/07, track D).
 *
 * Export (D1) : snapshot JSON versionné de toutes les tables métier du tenant,
 * dans l'ordre FK parents → enfants. Secrets (mots de passe, jetons SMS…)
 * JAMAIS exportés ; users, plans, licences, refresh_tokens et audit_logs
 * (journal immuable) exclus par conception.
 *
 * Import (D2) : `preview` = zéro écriture, validation + rapport (philosophie
 * du migrateur V1→V2) ; `replace` = purge ciblée des tables métier du tenant
 * courant puis réinsertion, le tout en UNE transaction (tout-ou-rien).
 * Toute référence utilisateur inconnue (clone vers un autre tenant) est
 * rabattue sur le compte qui lance l'import — notamment les colonnes NOT NULL
 * (sales.vendor_id, cash_sessions.opened_by) qui l'exigent.
 */

/* ------------------------------ Sections --------------------------------- */

type Scope =
  { kind: "tenant" } | { kind: "parent"; column: string; parentTable: string };

interface Section {
  table: string;
  scope: Scope;
  /** Colonnes de jointure exportées pour l'export (clé primaire parente). */
  parentKey?: string;
}

/** Ordre d'insertion (FK parents → enfants). Exclusions documentées ci-dessus. */
const SECTIONS: Section[] = [
  { table: "units", scope: { kind: "tenant" } },
  { table: "categories", scope: { kind: "tenant" } },
  { table: "depots", scope: { kind: "tenant" } },
  { table: "suppliers", scope: { kind: "tenant" } },
  { table: "customers", scope: { kind: "tenant" } },
  { table: "products", scope: { kind: "tenant" } },
  {
    table: "product_variants",
    scope: { kind: "parent", column: "product_id", parentTable: "products" },
  },
  { table: "product_barcodes", scope: { kind: "tenant" } },
  { table: "barcode_sequences", scope: { kind: "tenant" } },
  { table: "product_depot_settings", scope: { kind: "tenant" } },
  { table: "promotions", scope: { kind: "tenant" } },
  { table: "price_history", scope: { kind: "tenant" } },
  {
    table: "stock_levels",
    scope: { kind: "parent", column: "product_id", parentTable: "products" },
  },
  {
    table: "stock_batches",
    scope: { kind: "parent", column: "product_id", parentTable: "products" },
  },
  { table: "product_serials", scope: { kind: "tenant" } },
  { table: "stock_receipts", scope: { kind: "tenant" } },
  {
    table: "stock_receipt_items",
    scope: {
      kind: "parent",
      column: "receipt_id",
      parentTable: "stock_receipts",
    },
  },
  { table: "stock_movements", scope: { kind: "tenant" } },
  { table: "stock_transfers", scope: { kind: "tenant" } },
  {
    table: "stock_transfer_items",
    scope: {
      kind: "parent",
      column: "transfer_id",
      parentTable: "stock_transfers",
    },
  },
  {
    table: "stock_transfer_item_batches",
    scope: {
      kind: "parent",
      column: "transfer_item_id",
      parentTable: "stock_transfer_items",
    },
  },
  { table: "inventory_campaigns", scope: { kind: "tenant" } },
  {
    table: "inventory_campaign_products",
    scope: {
      kind: "parent",
      column: "campaign_id",
      parentTable: "inventory_campaigns",
    },
  },
  {
    table: "inventory_count_items",
    scope: {
      kind: "parent",
      column: "campaign_id",
      parentTable: "inventory_campaigns",
    },
  },
  { table: "cash_sessions", scope: { kind: "tenant" } },
  { table: "purchase_orders", scope: { kind: "tenant" } },
  {
    table: "purchase_order_items",
    scope: {
      kind: "parent",
      column: "po_id",
      parentTable: "purchase_orders",
    },
  },
  { table: "supplier_returns", scope: { kind: "tenant" } },
  {
    table: "supplier_return_items",
    scope: {
      kind: "parent",
      column: "return_id",
      parentTable: "supplier_returns",
    },
  },
  { table: "quotes", scope: { kind: "tenant" } },
  {
    table: "quote_items",
    scope: { kind: "parent", column: "quote_id", parentTable: "quotes" },
  },
  { table: "sales", scope: { kind: "tenant" } },
  {
    table: "sale_items",
    scope: { kind: "parent", column: "sale_id", parentTable: "sales" },
  },
  { table: "sale_payments", scope: { kind: "tenant" } },
  {
    table: "sale_returns",
    scope: { kind: "parent", column: "sale_id", parentTable: "sales" },
  },
  {
    table: "sale_return_items",
    scope: {
      kind: "parent",
      column: "return_id",
      parentTable: "sale_returns",
    },
  },
  { table: "invoice_sequences", scope: { kind: "tenant" } },
  { table: "invoices", scope: { kind: "tenant" } },
  {
    table: "invoice_items",
    scope: { kind: "parent", column: "invoice_id", parentTable: "invoices" },
  },
  { table: "notification_settings", scope: { kind: "tenant" } },
  { table: "notifications", scope: { kind: "tenant" } },
  { table: "tenant_configs", scope: { kind: "tenant" } },
];

const SECTION_BY_TABLE = new Map(SECTIONS.map((s) => [s.table, s]));

/** Tables purgées en mode replace (ordre inverse). Les sous-tables SANS
 *  colonne tenant_id (variantes, items, stock_levels, batches…) ne sont PAS
 *  listées : elles disparaissent par CASCADE avec leurs parents, et les FK
 *  ON DELETE RESTRICT (items → products, vendor/opened_by → users) sont
 *  honorées par l'ordre ci-dessous (parents logistiques avant catalogue). */
const PURGE_ORDER = SECTIONS.filter((s) => s.scope.kind === "tenant")
  .map((s) => s.table)
  .filter((t) => t !== "tenant_configs") // jamais purgés : upsert additif
  .reverse();

/** Colonnes référençant users(id) — rabattues sur l'admin important si la
 *  valeur n'est pas un compte du tenant courant (voir en-tête). */
const USER_REF_COLUMNS = new Set([
  "owner_id",
  "user_id",
  "created_by",
  "received_by",
  "counted_by",
  "validated_by",
  "closed_by",
  "opened_by",
  "issued_by",
  "changed_by",
  "updated_by",
  "vendor_id",
]);

const MAX_ROWS_TOTAL = 150_000;
const COL_RE = /^[a-z_][a-z0-9_]*$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------ Utilitaires ------------------------------ */

type Row = Record<string, unknown>;

function asRows(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

/** Identifiants SQL sûrs pour les clauses IN (UUIDs propres à notre base). */
function inList(ids: string[]): string | null {
  const clean = ids.filter((i) => UUID_RE.test(i));
  return clean.length ? clean.map((i) => `'${i}'`).join(",") : null;
}

function prepareValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v); // jsonb / arrays
  return v;
}

/* -------------------------------- Export D1 ------------------------------ */

export interface TenantSnapshot {
  format: "stockman-export";
  version: 1;
  exportedAt: string;
  appVersion: string;
  tenant: { name: string | null };
  counts: Record<string, number>;
  data: Record<string, Row[]>;
}

export async function exportTenantSnapshot(
  tenantId: string,
): Promise<TenantSnapshot> {
  const data: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};

  for (const s of SECTIONS) {
    let rows: Row[];
    if (s.scope.kind === "tenant") {
      if (s.table === "tenant_configs") {
        // Sécurité : secrets (SMS/WhatsApp, clés) EXCLUS du fichier.
        const r = await query(
          `SELECT * FROM tenant_configs
            WHERE tenant_id=$1 AND is_secret=false ORDER BY key`,
          [tenantId],
        );
        rows = r.rows;
      } else {
        const r = await query(`SELECT * FROM ${s.table} WHERE tenant_id=$1`, [
          tenantId,
        ]);
        rows = r.rows;
      }
    } else {
      const parents = data[s.scope.parentTable] ?? [];
      const ids = parents
        .map((p) => p.id as string)
        .filter((i) => typeof i === "string");
      const list = inList(ids);
      if (!list) {
        rows = [];
      } else {
        const chunk = 800;
        rows = [];
        for (let i = 0; i < ids.length; i += chunk) {
          const part = inList(ids.slice(i, i + chunk));
          if (!part) continue;
          const r = await query(
            `SELECT * FROM ${s.table} WHERE ${s.scope.column} IN (${part})`,
          );
          rows.push(...r.rows);
        }
      }
    }
    data[s.table] = rows;
    counts[s.table] = rows.length;
  }

  const t = await query(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  return {
    format: "stockman-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: process.env.APP_VERSION ?? "2.0.0",
    tenant: { name: (t.rows[0]?.name as string) ?? null },
    counts,
    data,
  };
}

/* --------------------------- Validation / preview ------------------------ */

export interface ImportPreview {
  ok: true;
  version: number;
  exportedAt: string;
  tenantName: string | null;
  tables: Record<string, number>;
  totalRows: number;
  /** Sections du fichier inconnues de cette version (ignorées à l'import). */
  ignoredSections: string[];
  /** Références utilisateurs inconnues → rabattues sur l'admin important. */
  remappedUserRefs: number;
  /** Clés de configuration à secret (exclues, jamais importées). */
  skippedSecretConfigs: number;
}

export class ImportValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function tenantUserIds(
  tenantId: string,
  client?: PoolClient,
): Promise<Set<string>> {
  const sql = `SELECT id FROM users WHERE tenant_id=$1`;
  const r = client
    ? await client.query(sql, [tenantId])
    : await query(sql, [tenantId]);
  return new Set(r.rows.map((x) => x.id as string));
}

function validateSnapshot(
  body: unknown,
  users: Set<string>,
): { snapshot: TenantSnapshot; preview: ImportPreview } {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ImportValidationError(
      "IMPORT_FORMAT",
      "Le fichier n'est pas un objet JSON de sauvegarde StockMan.",
    );
  const b = body as Record<string, unknown>;
  if (b.format !== "stockman-export")
    throw new ImportValidationError(
      "IMPORT_FORMAT",
      "Marqueur « stockman-export » absent : ce fichier n'est pas une sauvegarde StockMan.",
    );
  if (b.version !== 1)
    throw new ImportValidationError(
      "IMPORT_VERSION",
      `Version de sauvegarde ${String(b.version)} non prise en charge (attendue : 1).`,
    );
  const data = (b.data ?? {}) as Record<string, unknown>;
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new ImportValidationError(
      "IMPORT_FORMAT",
      "Section « data » invalide.",
    );

  const tables: Record<string, number> = {};
  const ignored: string[] = [];
  let total = 0;
  let remapped = 0;
  let skippedSecrets = 0;

  for (const [table, raw] of Object.entries(data)) {
    const section = SECTION_BY_TABLE.get(table);
    if (!section) {
      ignored.push(table);
      continue;
    }
    const rows = asRows(raw);
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row))
        throw new ImportValidationError(
          "IMPORT_FORMAT",
          `Ligne invalide dans la section « ${table} ».`,
        );
      total += 1;
      if (table === "tenant_configs" && row.is_secret === true)
        skippedSecrets += 1;
      for (const k of Object.keys(row)) {
        if (!COL_RE.test(k))
          throw new ImportValidationError(
            "IMPORT_FORMAT",
            `Nom de colonne inattendu « ${k} » (section ${table}).`,
          );
        if (
          USER_REF_COLUMNS.has(k) &&
          typeof row[k] === "string" &&
          UUID_RE.test(row[k] as string) &&
          !users.has(row[k] as string)
        )
          remapped += 1;
      }
    }
    if (total > MAX_ROWS_TOTAL)
      throw new ImportValidationError(
        "IMPORT_TOO_LARGE",
        `Sauvegarde trop volumineuse (${total} lignes > ${MAX_ROWS_TOTAL}) : restaurez côté serveur (pg_restore).`,
      );
    tables[table] = rows.length;
  }

  const snapshot = body as unknown as TenantSnapshot;
  return {
    snapshot,
    preview: {
      ok: true,
      version: 1,
      exportedAt: String(b.exportedAt ?? ""),
      tenantName: (b.tenant as { name?: string })?.name ?? null,
      tables,
      totalRows: total,
      ignoredSections: ignored,
      remappedUserRefs: remapped,
      skippedSecretConfigs: skippedSecrets,
    },
  };
}

export async function previewTenantImport(
  tenantId: string,
  body: unknown,
): Promise<ImportPreview> {
  const users = await tenantUserIds(tenantId);
  return validateSnapshot(body, users).preview;
}

/* ------------------------------- Import D2 ------------------------------- */

export interface ImportResult extends ImportPreview {
  applied: true;
}

/** Purge + réinsertion du tenant courant, en UNE transaction. */
export async function applyTenantImport(
  tenantId: string,
  admin: { id: string; name: string },
  body: unknown,
): Promise<ImportResult> {
  try {
    return await withTransaction(async (client) => {
      const users = await tenantUserIds(tenantId, client);
      const { snapshot, preview } = validateSnapshot(body, users);

      // 1. Purge ciblée (cascades auxiliaires : sous-tables sans tenant_id).
      for (const table of PURGE_ORDER) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [
          tenantId,
        ]);
      }

      // 2. Réinsertion ordonnée.
      for (const s of SECTIONS) {
        if (s.table === "tenant_configs") continue; // traité à l'étape 3
        const rows = asRows(snapshot.data[s.table]);
        // Colonnes = union des clés (section homogène en pratique).
        const cols: string[] = [];
        for (const row of rows)
          for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
        if (rows.length === 0) continue;

        // tenant_id TOUJOURS forcé au tenant courant sur les tables scopées.
        const scoped = s.scope.kind === "tenant";
        if (scoped && !cols.includes("tenant_id")) cols.push("tenant_id");

        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const part = rows.slice(i, i + CHUNK);
          const params: unknown[] = [];
          const values = part
            .map((row) => {
              const cells = cols.map((c) => {
                let v = row[c];
                if (scoped && c === "tenant_id") v = tenantId;
                if (
                  USER_REF_COLUMNS.has(c) &&
                  typeof v === "string" &&
                  UUID_RE.test(v) &&
                  !users.has(v)
                )
                  v = admin.id; // rabattement utilisateur (NOT NULL compris)
                params.push(prepareValue(v));
                return `$${params.length}`;
              });
              return `(${cells.join(",")})`;
            })
            .join(",");
          await client.query(
            `INSERT INTO ${s.table} (${cols.join(",")}) VALUES ${values}`,
            params,
          );
        }
      }

      // 3. Configurations NON secrètes : upsert additif (les secrets du tenant
      //    courant — clés SMS/WhatsApp — sont préservés et jamais écrasés).
      for (const row of asRows(snapshot.data.tenant_configs)) {
        if (row.is_secret === true) continue;
        if (typeof row.key !== "string" || !COL_RE.test(row.key)) continue;
        await client.query(
          `INSERT INTO tenant_configs (tenant_id, key, value, is_secret)
         VALUES ($1,$2,$3,false)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value=EXCLUDED.value, is_secret=false`,
          [tenantId, row.key, prepareValue(row.value)],
        );
      }

      // 4. Journalisation (dans la même transaction).
      await writeAudit(
        {
          tenantId,
          userId: admin.id,
          userName: admin.name,
          action: "IMPORT",
          entity: "tenant_data",
          details: `Restauration des données (mode replace) : ${preview.totalRows} lignes, ${preview.remappedUserRefs} réf. utilisateurs rabattues, fichier du ${preview.exportedAt}.`,
        },
        client,
      );

      return { ...preview, applied: true };
    });
  } catch (e) {
    // Toute erreur ligne (type, FK, colonne) ⇒ transaction annulée : rien
    // n'a été modifié. On rend un 400 métier EXPLICITE plutôt qu'un 500.
    if (e instanceof ImportValidationError) throw e;
    throw new ImportValidationError(
      "IMPORT_ROW_INVALID",
      `Import interrompu — aucune donnée n'a été modifiée (mode tout-ou-rien). Détail : ${String(
        e instanceof Error ? e.message : e,
      ).slice(0, 200)}`,
    );
  }
}
