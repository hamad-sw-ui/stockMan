import { PoolClient } from "pg";
import { query } from "../config/db";

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  userName?: string | null;
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "ARCHIVE"
    | "RESTORE"
    | "VOID"
    | "RETURN"
    | "LOGIN"
    | "IMPERSONATE"
    | "TRANSFER"
    | "RECEIPT"
    | "ADJUST"
    | "SALE"
    | "CONFIG"
    | "LICENSE"
    | "IMPORT"
    | "EXPORT"
    | "MIGRATION"
    | "REVALUE"
    | "PAYMENT"
    | "REMIND"
    | "QUOTE"
    | "PURCHASE_ORDER"
    | "SUPPLIER_RETURN"
    | "CAMPAIGN"
    | "SESSION"
    | "INVOICE"
    | "SERIAL"
    | "PRICE";
  entity: string;
  entityId?: string | null;
  previousState?: unknown;
  newState?: unknown;
  details?: string;
  depotId?: string | null;
}

/**
 * Écrit une entrée dans audit_logs (corrige DAT-06 : la table est enfin
 * alimentée). Accepte un client transactionnel pour rester atomique avec
 * l'opération auditée.
 */
export async function writeAudit(
  entry: AuditEntry,
  client?: PoolClient,
): Promise<void> {
  const sql = `INSERT INTO audit_logs
    (tenant_id, user_id, user_name, action, entity, entity_id, previous_state, new_state, details, depot_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const params = [
    entry.tenantId,
    entry.userId ?? null,
    entry.userName ?? null,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.previousState == null ? null : JSON.stringify(entry.previousState),
    entry.newState == null ? null : JSON.stringify(entry.newState),
    entry.details ?? null,
    entry.depotId ?? null,
  ];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
