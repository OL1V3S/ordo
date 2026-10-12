import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CommitmentEvidence from "./CommitmentEvidence";
import i18n from "../../../shared/localization/i18n";

describe("commitment evidence fallbacks in Spanish", () => {
  beforeEach(async () => { await i18n.changeLanguage("es"); });
  afterEach(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

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
