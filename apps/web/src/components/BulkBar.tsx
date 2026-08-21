/** Barre d'actions groupées (BulkBar) : apparaît dès qu'une sélection est
 *  active, affiche le compteur et les actions disponibles. Sticky en bas de
 *  page. Socle partagé par les listes (catalogue, clients, fournisseurs…). */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

export interface BulkAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "outline" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}

export function BulkBar({
  count,
  countLabel,
  actions,
  onClear,
}: {
  count: number;
  /** Libellé du compteur (déjà traduit), ou une fonction du compteur. */
  countLabel?: (count: number) => ReactNode;
  actions: BulkAction[];
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="row"
      style={{
        position: "sticky",
        bottom: 12,
        justifyContent: "space-between",
        background: "var(--surface)",
        border: "1px solid var(--line, #d7dee6)",
        borderRadius: "var(--radius, 8px)",
        padding: "10px 14px",
        boxShadow: "var(--shadow-m, 0 6px 18px rgba(15,23,42,.12))",
        marginTop: 10,
        zIndex: 5,
      }}
      data-testid="bulk-bar"
    >
      <span style={{ fontWeight: 600 }}>
        {countLabel ? countLabel(count) : t("bulk.selectedCount", { count })}
      </span>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button variant="ghost" size="sm" onClick={onClear}>
          {t("bulk.clear")}
        </Button>
        {actions.map((a, i) => (
          <Button
            key={i}
            variant={a.variant ?? "primary"}
            size="sm"
            onClick={a.onClick}
            disabled={a.disabled}
            loading={a.loading}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
