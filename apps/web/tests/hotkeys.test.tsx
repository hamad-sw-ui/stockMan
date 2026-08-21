/** Socle « raccourcis clavier » : le hook useHotkeys déclenche les
 *  combinaisons simples, les séquences à deux touches, et ignore les frappes
 *  dans les champs de saisie. */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHotkeys } from "../src/lib/hotkeys";

function fireKey(key: string, init: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useHotkeys", () => {
  it("déclenche une combinaison simple (lettre seule)", () => {
    const spy = vi.fn();
    renderHook(() => useHotkeys({ "/": spy }));
    fireKey("/");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("déclenche une combinaison avec modificateur (Ctrl+K)", () => {
    const spy = vi.fn();
    renderHook(() => useHotkeys({ "ctrl+k": spy }));
    fireKey("k", { ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("déclenche une séquence à deux touches (g puis d)", () => {
    const spy = vi.fn();
    renderHook(() => useHotkeys({ "g d": spy }));
    fireKey("g");
    fireKey("d");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignore les frappes dans un champ de saisie", () => {
    const spy = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useHotkeys({ "/": spy }));
    fireKey("/");
    expect(spy).not.toHaveBeenCalled();
  });
});
