import { createRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ExpenseEditPanel from "./ExpenseEditPanel";
import i18n from "../../../shared/localization/i18n";

const expense = { id: 42, description: "Lunch", amount: "12.50", date: "2026-08-14", category: "food" };
const data = { description: "Lunch", amount: "12.50", date: "2026-08-14", category: "food", customCategory: "" };

function Harness({ initial = data, onSave = vi.fn(), onCancel = vi.fn(), ...props }) {
  const [editing, setEditing] = useState(initial);
  return <ExpenseEditPanel expense={expense} editingData={editing} setEditingData={setEditing} onSave={onSave} onCancel={onCancel} {...props} />;
}

describe("ExpenseEditPanel", () => {
  it("shows initial values, focuses the visible description on mount and calls Save with the id", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const descriptionRef = createRef();
    render(<Harness onSave={onSave} descriptionRef={descriptionRef} />);
    const group = screen.getByRole("group", { name: "Edit expense" });
    expect(group).toBeVisible();
    const description = screen.getByLabelText("Edit description");
    expect(description).toHaveValue("Lunch");
    expect(description).toBeVisible();
    expect(description).toHaveFocus();
    expect(descriptionRef.current).toBe(description);
    expect(screen.getByLabelText("Edit amount")).toHaveValue("12.50");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(42);
  });

  it("disables Save for an invalid amount, busy or unavailable reads, but keeps Cancel enabled unless busy", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness initial={{ ...data, amount: "abc" }} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Enter a valid exact amount.")).toBeVisible();
    await user.clear(screen.getByLabelText("Edit amount"));
    await user.type(screen.getByLabelText("Edit amount"), "3.10");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    rerender(<Harness readUnavailable />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

    rerender(<Harness busy />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Edit description")).toBeDisabled();
    expect(screen.getByLabelText("Edit category")).toBeDisabled();
  });

  it("shows the custom category field only for Other and calls Cancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    expect(screen.queryByLabelText("Edit custom category")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Edit category"), "other");
    expect(screen.getByLabelText("Edit custom category")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps the visible label inside the accessible name in English and Spanish", async () => {
    for (const lng of ["en", "es"]) {
      await i18n.changeLanguage(lng);
      const { unmount } = render(<Harness />);
      for (const input of screen.getAllByRole("textbox")) {
        const visible = input.closest("label")?.firstChild?.textContent?.trim();
        if (visible) expect(input.getAttribute("aria-label").toLowerCase()).toContain(visible.toLowerCase());
      }
      unmount();
    }
    await i18n.changeLanguage("en");
  });
});
