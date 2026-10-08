import { screen } from "@testing-library/react";

// Records lists are collapsed by default; open one by its toggle (no-op when already open).
export async function openRecords(user, name) {
  const toggle = screen.getByRole("button", { name });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  return toggle;
}
export const openSpending = (user) => openRecords(user, "Spending records");
export const openCashIn = (user) => openRecords(user, "Cash-in records");
