/** F3 — Verrou POS : une fois la caisse ouverte via le formulaire, le verrou
 *  doit se fermer immédiatement (l'invalidation « cash: » déclenche un
 *  re-fetch du composant monté, cf. F1). */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashSessionGate } from "../src/components/CashSessionGate";
import { ToastProvider } from "../src/store/toast";
import { invalidateQueries } from "../src/lib/query";
import * as http from "../src/lib/http";
import type { CashSession, CashSessionCurrent } from "../src/lib/types";

const session = {
  id: "s1",
  depotId: "d1",
  status: "OPEN",
  businessDate: "2026-08-21",
  openedBy: "u1",
  openedAt: "2026-08-21T10:00:00Z",
  openingFloat: 0,
  note: null,
  expected: { CASH: 0, MTN_MOMO: 0, ORANGE_MONEY: 0 },
} as CashSessionCurrent["session"];

beforeEach(() => {
  vi.restoreAllMocks();
  invalidateQueries();
});
afterEach(cleanup);

describe("CashSessionGate", () => {
  it("affiche le verrou quand une caisse est requise et aucune n'est ouverte", async () => {
    vi.spyOn(http, "get").mockResolvedValue({
      required: true,
      session: null,
    } as CashSessionCurrent);
    render(
      <ToastProvider>
        <CashSessionGate />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Ouvrez la caisse/i)).toBeInTheDocument(),
    );
  });

  it("se referme dès que la caisse est ouverte (invalidation → re-fetch)", async () => {
    const user = userEvent.setup();
    let open = false;
    vi.spyOn(http, "get").mockImplementation(async () => {
      return {
        required: true,
        session: open ? session : null,
      } as CashSessionCurrent;
    });
    vi.spyOn(http, "post").mockImplementation(async () => {
      open = true;
      return session as CashSession;
    });

    render(
      <ToastProvider>
        <CashSessionGate />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Ouvrez la caisse/i)).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /Ouvrir la caisse/i }),
    );

    // Le verrou doit disparaître : la modale n'est plus rendue.
    await waitFor(() =>
      expect(screen.queryByText(/Ouvrez la caisse pour commencer/i)).toBeNull(),
    );
  });
});
