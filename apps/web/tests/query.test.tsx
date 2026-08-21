/** F1 — Invalidation du cache : un composant MONTÉ alimenté par `useQuery`
 *  doit se re-fetcher immédiatement après `invalidateQueries` (préfixe
 *  correspondant). C'est le correctif qui rend les listes réactives après
 *  une création / édition / suppression. */
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery, invalidateQueries, onInvalidate } from "../src/lib/query";
import * as http from "../src/lib/http";

beforeEach(() => {
  vi.restoreAllMocks();
  // Le cache est global au module : on le vide pour isoler chaque test.
  invalidateQueries();
});
afterEach(cleanup);

function Probe() {
  const q = useQuery<{ v: number }>("probe:key", "/probe");
  return <div data-testid="v">{q.data ? q.data.v : "none"}</div>;
}

describe("useQuery — invalidation", () => {
  it("re-fetch un composant monté quand son préfixe est invalidé", async () => {
    let calls = 0;
    vi.spyOn(http, "get").mockImplementation(async () => {
      calls += 1;
      return { v: calls } as never;
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("1"));

    act(() => {
      invalidateQueries("probe:");
    });
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("2"));
    expect(calls).toBe(2);
  });

  it("n'invalide pas un composant dont le préfixe ne correspond pas", async () => {
    let calls = 0;
    vi.spyOn(http, "get").mockImplementation(async () => {
      calls += 1;
      return { v: calls } as never;
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("1"));

    act(() => {
      invalidateQueries("other:");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
    expect(screen.getByTestId("v")).toHaveTextContent("1");
  });

  it("invalidation globale (sans préfixe) re-fetch tout composant monté", async () => {
    let calls = 0;
    vi.spyOn(http, "get").mockImplementation(async () => {
      calls += 1;
      return { v: calls } as never;
    });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("1"));

    act(() => {
      invalidateQueries();
    });
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("2"));
    expect(calls).toBe(2);
  });
});

describe("onInvalidate — cycle de vie", () => {
  it("retire l'auditeur au démontage (pas de fuite)", () => {
    const spy = vi.fn();
    const off = onInvalidate(spy);
    invalidateQueries("x:");
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    invalidateQueries("x:");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
