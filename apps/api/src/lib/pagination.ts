import { z } from 'zod';

/** Pagination page/size classique (listes métier). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageParams(q: PageQuery) {
  return { limit: q.size, offset: (q.page - 1) * q.size };
}

export function paged<T>(rows: T[], total: number, q: PageQuery) {
  return {
    data: rows,
    page: q.page,
    size: q.size,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.size)),
  };
}

/** Pagination cursor (journaux append-only : mouvements, audit).
 *  Cursor = `${created_at ISO}|${id}` décodé côté SQL. */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx <= 0) return null;
    return { createdAt: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}
