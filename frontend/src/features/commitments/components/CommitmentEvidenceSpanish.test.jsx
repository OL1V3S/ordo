import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CommitmentEvidence from "./CommitmentEvidence";
import i18n from "../../../shared/localization/i18n";

describe("commitment evidence fallbacks in Spanish", () => {
  beforeEach(async () => { await i18n.changeLanguage("es"); });
  afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  it("shows localized category names for known keys and a custom category as it displayed before, in both languages", async () => {
    const evidence = [
      { expenseId: 1, description: "A", date: "2026-08-02", category: "food", source: "manual", amount: "1.00" },
      { expenseId: 2, description: "B", date: "2026-08-03", category: "uncategorized", source: "manual", amount: "2.00" },
      { expenseId: 3, description: "C", date: "2026-08-04", category: "home repair", source: "manual", amount: "3.00" },
    ];
    const { container, rerender } = render(<CommitmentEvidence evidence={evidence} />);
    const categories = () => [...container.querySelectorAll("li > div > span:first-of-type")].map((node) => node.textContent.split(" · ")[1]);
    expect(categories()).toEqual(["Comida", "Sin categoría", "Home Repair"]);
    await act(async () => { await i18n.changeLanguage("en"); });
    rerender(<CommitmentEvidence evidence={evidence} />);
    expect(categories()).toEqual(["Food", "Uncategorized", "Home Repair"]);
  });

  it("shows the Spanish unavailable-amount label instead of the English fallback", () => {
    render(<CommitmentEvidence evidence={[
      { expenseId: 1, description: "Gym", date: "2026-08-02", category: "food", source: "manual", amount: "abc" },
      { expenseId: 2, description: "Rent", date: "2026-08-03", category: "bills", source: "manual", amount: "20.00" },
    ]} />);
    expect(screen.getByText("Monto exacto no disponible")).toBeInTheDocument();
    expect(screen.queryByText("Exact amount unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("USD 20.00")).toBeInTheDocument();
  });
});
