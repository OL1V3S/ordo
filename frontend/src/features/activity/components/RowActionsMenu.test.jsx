import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RowActionsMenu from "./RowActionsMenu";
import "../../../shared/localization/i18n";

const labelValues = { description: "Lunch", date: "08/14/2026", id: 42 };
const TRIGGER = "Actions for expense Lunch from 08/14/2026, record 42";

function setup(props = {}) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn() };
  const view = render(<><RowActionsMenu kind="expense" labelValues={labelValues} state={{ canEdit: true, canDelete: true }} {...handlers} {...props} />
    <button type="button">Outside</button></>);
  return { ...handlers, ...view };
}

describe("RowActionsMenu", () => {
  it("is a disclosure group (not a menu) whose panel is hidden until opened", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: TRIGGER });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit expense/ })).toBeNull();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(screen.getByRole("group", { name: TRIGGER })).toBe(panel);
    expect(screen.getByRole("button", { name: "Edit expense Lunch from 08/14/2026, record 42" })).toHaveTextContent("Edit");
    expect(screen.getByRole("button", { name: "Delete expense Lunch from 08/14/2026, record 42" })).toHaveTextContent("Delete");
  });

  it("closes on Escape from the trigger and from an item, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: TRIGGER });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.tab();
    expect(screen.getByRole("button", { name: /^Edit expense/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Edit expense/ })).toBeNull();
  });

  it("closes on outside pointerdown and when focus leaves the wrapper", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: TRIGGER });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("focuses the trigger before calling the handler with it as the opener", async () => {
    const user = userEvent.setup();
    const seen = [];
    const onDelete = vi.fn((opener) => seen.push(document.activeElement === opener));
    setup({ onDelete });
    const trigger = screen.getByRole("button", { name: TRIGGER });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: /^Delete expense/ }));
    expect(onDelete).toHaveBeenCalledWith(trigger);
    expect(seen).toEqual([true]);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves focus on the trigger when the native expense delete confirm is cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setup({ onDelete: () => window.confirm("Delete this expense?") });
    const trigger = screen.getByRole("button", { name: TRIGGER });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: /^Delete expense/ }));
    expect(confirm).toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    confirm.mockRestore();
  });

  it("disables the trigger when both actions are unavailable and closes when that happens while open", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    const trigger = screen.getByRole("button", { name: TRIGGER });
    await user.click(trigger);
    rerender(<><RowActionsMenu kind="expense" labelValues={labelValues} state={{ canEdit: false, canDelete: false }} onEdit={vi.fn()} onDelete={vi.fn()} />
      <button type="button">Outside</button></>);
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(trigger.getAttribute("aria-controls"))).not.toBeVisible();
  });

  it("disables one item when only one action is available", async () => {
    const user = userEvent.setup();
    setup({ state: { canEdit: false, canDelete: true } });
    await user.click(screen.getByRole("button", { name: TRIGGER }));
    expect(screen.getByRole("button", { name: /^Edit expense/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Delete expense/ })).toBeEnabled();
  });
});
