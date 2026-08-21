/** Export CSV côté client (actions groupées) : génère un fichier CSV à partir
 *  de lignes de tableaux, sans dépendance serveur. Échappe les champs selon le
 *  RFC 4180 (guillemets doublés). */
function escapeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

/** Télécharge un contenu texte (CSV) sous un nom de fichier donné. */
export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
