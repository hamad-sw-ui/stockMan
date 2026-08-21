/** Socle « actions groupées » : le hook useSelection doit gérer la bascule
 *  unitaire, le « tout sélectionner », l'effacement et l'identité. */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "../src/lib/selection";

describe("useSelection", () => {
  it("bascule un identifiant et compte la sélection", () => {
    const { result } = renderHook(() => useSelection<string>());
    expect(result.current.size).toBe(0);

    act(() => result.current.toggle("a"));
    expect(result.current.has("a")).toBe(true);
    expect(result.current.size).toBe(1);

    act(() => result.current.toggle("a"));
    expect(result.current.has("a")).toBe(false);
    expect(result.current.size).toBe(0);
  });

  it("sélectionne / désélectionne toute une page (toggleAll)", () => {
    const { result } = renderHook(() => useSelection<string>());
    act(() => result.current.toggleAll(["a", "b", "c"], true));
    expect(result.current.size).toBe(3);
    expect([...result.current.ids()].sort()).toEqual(["a", "b", "c"]);

    act(() => result.current.toggleAll(["a", "b", "c"], false));
    expect(result.current.size).toBe(0);
  });

  it("efface la sélection et expose les ids", () => {
    const { result } = renderHook(() => useSelection<string>());
    act(() => result.current.toggleAll(["x", "y"], true));
    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
    expect(result.current.ids()).toEqual([]);
  });
});
