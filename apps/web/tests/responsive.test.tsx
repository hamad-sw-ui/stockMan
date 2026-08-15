/** R1 — Fondations responsives : le contrat est doublement verrouillé.
 *  1. Composant Modal : l'opt-out « keep » pose la classe `modal-keep`
 *     (les confirmations courtes — ConfirmModal — restent centrées).
 *  2. Feuille globale : les renforts R1 existent, sont confinés à
 *     `screen` (impressions intactes) et les garde-fous historiques
 *     (étiquettes A4/thermiques, reçus 80 mm) n'ont pas disparu. */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { i18n } from "../src/i18n";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmModal, Modal } from "../src/components/ui";

const css = readFileSync(
  join(__dirname, "..", "src", "styles", "global.css"),
  "utf8",
);

afterEach(cleanup);

describe("R1 — Modale : opt-out confirmations courtes", () => {
  it("Modal sans keep devient plein écran (pas de classe modal-keep)", () => {
    const { container } = render(
      <Modal title="Titre" onClose={() => {}}>
        Contenu
      </Modal>,
    );
    expect(container.querySelector(".modal")).not.toBeNull();
    expect(container.querySelector(".modal-keep")).toBeNull();
  });

  it("Modal keep conserve la boîte centrée sur téléphone", () => {
    const { container } = render(
      <Modal title="Titre" onClose={() => {}} keep>
        Contenu
      </Modal>,
    );
    expect(container.querySelector(".modal.modal-keep")).not.toBeNull();
  });

  it("ConfirmModal — confirmation courte — opte automatiquement pour keep", () => {
    const { container } = render(
      <ConfirmModal
        title="Supprimer ?"
        message="Action irréversible."
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".modal.modal-keep")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Confirmer" }),
    ).toBeInTheDocument();
  });
});

describe("R1 — Feuille globale (contrat statique)", () => {
  it("documente les breakpoints unifiés du projet", () => {
    expect(css).toMatch(
      /Breakpoints unifiés du projet.*360.*640.*860.*1000.*1080/s,
    );
  });

  it("passe les modales en plein écran ≤ 640 px — uniquement à l'écran", () => {
    // La règle doit exister ET être préfixée `screen` : un reçu 80 mm
    // (page étroite au print) ne doit jamais hériter du plein écran.
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*640px\)\s*\{[^}]*\.modal-backdrop\s*\{\s*padding:\s*0/s,
    );
    const screenBlock = css.match(
      /@media\s+screen\s+and\s+\(max-width:\s*640px\)\s*\{[\s\S]*?\.modal\s*\{[\s\S]*?min-height:\s*100dvh/,
    );
    expect(screenBlock).not.toBeNull();
  });

  it("garantit les cibles tactiles ≥ 40 px sur pointeur grossier", () => {
    const coarse = css.match(
      /@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(coarse).not.toBeNull();
    expect(coarse![1]).toMatch(/\.btn\s*\{[\s\S]*?min-height:\s*40px/);
    expect(coarse![1]).toMatch(/\.side-link\s*\{/);
  });

  it("impose ≥ 16 px aux champs ≤ 640 px (anti auto-zoom iOS)", () => {
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*640px\)\s*\{[\s\S]*?input,[\s\S]*?font-size:\s*max\(16px/s,
    );
  });

  it("expose l'utilitaire .filters-row repliable", () => {
    expect(css).toMatch(/\.filters-row\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });

  it("préserve les règles d'impression historiques (régression interdite)", () => {
    expect(css).toMatch(/@media\s+print\s*\{[\s\S]*?\.labels-print/);
    expect(css).toMatch(/@media\s+print\s*\{[\s\S]*?\.receipt-print/);
    expect(css).toMatch(/@page\s*\{[\s\S]*?size:\s*A4/);
    expect(css).toMatch(/tpl-50x30/);
    expect(css).toMatch(/tpl-38x25/);
  });
});

/* ---------------------------------------------------------------- R2 ---- */

describe("R2 — Pattern listes → cartes (≤ 760 px)", () => {
  it("la feuille expose le pattern .table-cards additif", () => {
    // En-tête masqué
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*760px\)\s*\{[\s\S]*?\.table-cards thead\s*\{\s*display:\s*none/,
    );
    // Libellé injecté depuis l'attribut data-label
    expect(css).toMatch(
      /\.table-cards td::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/,
    );
    // Lignes transformées en cartes — confinées à `screen` (impression intacte)
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*760px\)\s*\{[\s\S]*?\.table-cards tbody tr\s*\{\s*display:\s*block/,
    );
  });

  // Chaque libellé : [texte FR, clé i18n | null].
  // - clé = null  → page non encore convertie : data-label littéral attendu ;
  // - clé i18n    → page convertie (I3+) : data-label={t("clé")} attendu ET
  //   la valeur FR de la clé doit rester identique au libellé historique
  //   (non-régression mobile : le libellé affiché ne change pas en FR).
  it.each([
    [
      "SalesPage",
      [
        ["Date", "common.date"],
        ["Vendeur", "fields.vendor"],
        ["Montant", "common.amount"],
        ["Paiement", "fields.payment"],
        ["Statut", "common.status"],
      ],
    ],
    [
      "ProductsPage",
      [
        ["Produit", "fields.product"],
        ["Catégorie", "fields.category"],
        ["Prix vente", "pages.products.colSellingPrice"],
        ["Stock", "pages.products.colStock"],
        ["Seuil", "pages.products.colThreshold"],
      ],
    ],
    [
      "CustomersPage",
      [
        ["Nom", "fields.name"],
        ["Téléphone", "fields.phone"],
        ["Solde dû", "pages.customers.colDue"],
        ["Statut", "common.status"],
      ],
    ],
    [
      "SuppliersPage",
      [
        ["Nom", "fields.name"],
        ["Téléphone", "fields.phone"],
        ["Délai", "pages.suppliers.colDelay"],
        ["Réceptions", "pages.suppliers.colReceipts"],
      ],
    ],
    [
      "PurchaseOrdersPage",
      [
        ["Créée le", "pages.purchaseOrders.colCreated"],
        ["Fournisseur", "fields.supplier"],
        ["Statut", "common.status"],
        // OTIF : acronyme métier identique dans les deux langues.
        ["OTIF", null],
      ],
    ],
    [
      "ReceiptsPage",
      [
        ["Date", "common.date"],
        ["Fournisseur", "fields.supplier"],
        ["Montant", "common.amount"],
        ["Par", "pages.movements.by"],
      ],
    ],
    [
      "QuotesPage",
      [
        ["Date", "common.date"],
        ["Client", "fields.customer"],
        ["Total", "common.total"],
        ["Validité", "pages.quotes.colValidity"],
        ["Statut", "common.status"],
      ],
    ],
  ] as Array<[string, Array<[string, string | null]>]>)(
    "%s : table-cards + chaque cellule porte un data-label",
    (page, labels) => {
      const src = readFileSync(
        join(__dirname, "..", "src", "pages", "admin", `${page}.tsx`),
        "utf8",
      );
      expect(src).toMatch(/table-wrap table-cards/);
      for (const [label, key] of labels) {
        if (key) {
          expect(
            src.includes(`data-label={t("${key}")}`),
            `${page} : data-label i18n « ${key} » manquant`,
          ).toBe(true);
          // La traduction FR doit rester le libellé historique affiché.
          expect(i18n.t(key), `${page} : « ${key} » ≠ « ${label} »`).toBe(
            label,
          );
        } else {
          expect(
            src.includes(`data-label="${label}"`),
            `${page} : data-label « ${label} » manquant`,
          ).toBe(true);
        }
      }
      // Discipline d'exhaustivité : tout <td> du fichier a son data-label.
      const tdCount = (src.match(/<td\b/g) ?? []).length;
      const labelCount = (src.match(/data-label=/g) ?? []).length;
      expect(
        labelCount,
        `${page} : ${labelCount} data-label pour ${tdCount} <td>`,
      ).toBe(tdCount);
    },
  );
});

describe("R2 — POS : panier en panneau bas (≤ 480 px)", () => {
  it("la feuille expose la barre panier mobile", () => {
    expect(css).toMatch(/\.pos-bar-toggle\s*\{\s*display:\s*none/);
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*480px\)[\s\S]*?\.pos-bar\s*\{[\s\S]*?position:\s*fixed/,
    );
    expect(css).toMatch(
      /\.pos-bar:not\(\.open\) \.pos-bar-body\s*\{\s*display:\s*none/,
    );
    expect(css).toMatch(/\.pos-cart-count\s*\{/);
  });

  it("PosPage câble poignée, compteur, total et corps repliable", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "pages", "vendor", "PosPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/pos-cart pos-bar\$\{cartOpen \? " open" : ""\}/);
    expect(src).toMatch(/className="pos-bar-toggle"/);
    expect(src).toMatch(/className="pos-cart-count"/);
    expect(src).toMatch(/className="pos-bar-total money"/);
    expect(src).toMatch(/className="pos-bar-body"/);
    expect(src).toMatch(/aria-expanded=\{cartOpen\}/);
    expect(src).toMatch(/className="empty empty-block"/);
    expect(src).toMatch(/className="pay-grid pos-bar-actions"/);
    expect(src).toMatch(/className="name product-name"/);
  });
});

describe("R2 — Formulaires en 1 colonne ≤ 640 px", () => {
  it("les champs .row > .field passent pleine largeur sur téléphone", () => {
    expect(css).toMatch(
      /@media\s+screen\s+and\s+\(max-width:\s*640px\)[\s\S]*?\.row > \.field\s*\{[\s\S]*?flex:\s*1 1 100%/,
    );
  });
});
