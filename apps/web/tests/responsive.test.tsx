/** R1 — Fondations responsives : le contrat est doublement verrouillé.
 *  1. Composant Modal : l'opt-out « keep » pose la classe `modal-keep`
 *     (les confirmations courtes — ConfirmModal — restent centrées).
 *  2. Feuille globale : les renforts R1 existent, sont confinés à
 *     `screen` (impressions intactes) et les garde-fous historiques
 *     (étiquettes A4/thermiques, reçus 80 mm) n'ont pas disparu. */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
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
