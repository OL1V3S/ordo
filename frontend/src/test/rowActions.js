import { screen } from "@testing-library/react";

// The timeline row actions live in a "…" disclosure. These helpers open it the way a user does.
const ACTION_NAME = /^(Edit|Delete|Editar|Eliminar) /;

export function timelineFrom(expenses = [], inflows = []) {
  return [
    ...expenses.map((e) => ({
      kind: "expense", recordId: e.id, date: e.date, amount: String(e.amount), description: e.description,
      category: e.category ?? "", paycheck: null,
    })),
    ...inflows.map((i) => ({
      kind: "account_inflow", recordId: i.id, date: i.date, amount: String(i.amount), description: i.description,
      category: null, paycheck: null,
    })),
  ];
}

export async function openRowActions(user, pattern) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const trigger = screen.getAllByRole("button", { name: /^(Actions for|Acciones d)/ })
    .find((button) => matcher.test(button.getAttribute("aria-label")));
  if (!trigger) throw new Error(`No row actions trigger matches ${matcher}`);
  if (trigger.getAttribute("aria-expanded") !== "true") await user.click(trigger);
  return trigger;
}

// Opens the menu that owns the named action (exact string or regex) and clicks the action.
export async function chooseRowAction(user, actionName) {
  const items = screen.getAllByRole("button", { name: actionName, hidden: true })
    .filter((button) => ACTION_NAME.test(button.getAttribute("aria-label") ?? ""));
  if (items.length === 0) throw new Error(`No row action matches ${actionName}`);
  const trigger = items[0].closest(".row-actions-menu").querySelector(".row-actions-menu__trigger");
  if (trigger.getAttribute("aria-expanded") !== "true") await user.click(trigger);
  await user.click(items[0]);
  return trigger;
}
