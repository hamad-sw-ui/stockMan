/** Socle « actions groupées » : la BulkBar s'affiche avec le compteur,
 *  déclenche ses actions et efface la sélection. */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkBar } from "../src/components/BulkBar";

afterEach(cleanup);

describe("BulkBar", () => {
  it("affiche le compteur et les actions", () => {
    render(
      <BulkBar
        count={3}
        actions={[
          { label: "Archiver", onClick: () => undefined },
          { label: "Exporter", onClick: () => undefined },
        ]}
        onClear={() => undefined}
      />,
    );
    expect(screen.getByTestId("bulk-bar")).toBeInTheDocument();
    expect(screen.getByText(/3 sélectionné/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archiver" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter" })).toBeInTheDocument();
  });

  it("déclenche l'action et l'effacement", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const onClear = vi.fn();
    render(
      <BulkBar
        count={2}
        actions={[{ label: "Archiver", onClick: onArchive }]}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Archiver" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Effacer/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
