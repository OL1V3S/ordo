import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../shared/localization/i18n";
import { commitmentsApi } from "../api/commitmentsApi";
import { getCommitmentErrorMessage, useCommitments } from "./useCommitments";

vi.mock("../api/commitmentsApi", () => ({
  commitmentsApi: {
    getCandidates: vi.fn(), getCommitments: vi.fn(), getChanges: vi.fn(), dismissCandidate: vi.fn(),
    reconsiderCandidate: vi.fn(), confirmCandidate: vi.fn(), acceptAmountChange: vi.fn(), acceptTimingChange: vi.fn(),
    markEndedFromChange: vi.fn(), keepChange: vi.fn(), reconsiderChange: vi.fn(), updateCommitment: vi.fn(), updateLifecycle: vi.fn(),
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  commitmentsApi.getCandidates.mockResolvedValue({ data: { candidates: [], dismissedCandidates: [] } });
  commitmentsApi.getCommitments.mockResolvedValue({ data: [] });
  commitmentsApi.getChanges.mockResolvedValue({ data: { evaluatedOn: "2026-10-29", changes: [] } });
  commitmentsApi.confirmCandidate.mockResolvedValue({ data: { alreadyConfirmed: false } });
  commitmentsApi.dismissCandidate.mockResolvedValue({ data: null });
  commitmentsApi.keepChange.mockResolvedValue({ data: null });
  await i18n.changeLanguage("es");
});

afterEach(() => i18n.changeLanguage("en"));

describe("commitment state in Spanish", () => {
  it("returns Spanish notices and keeps them in step with the language", async () => {
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.confirmCandidate({ fingerprint: "candidate-1", name: "Rent" }));
    expect(result.current.notice).toBe("Compromiso confirmado.");
    await act(() => result.current.dismissCandidate("candidate-1"));
    expect(result.current.notice).toBe("Propuesta descartada. Puedes reconsiderarla más abajo.");
    await act(() => result.current.keepChange("commitment-1", "missing", "missing-fingerprint"));
    expect(result.current.notice).toBe("El compromiso se mantiene activo.");
    await act(() => result.current.keepChange("commitment-1", "amount", "amount-fingerprint"));
    expect(result.current.notice).toBe("Se mantiene la previsión actual.");

    await act(() => i18n.changeLanguage("en"));
    expect(result.current.notice).toBe("Current expectation kept.");
  });

  it("maps stable codes to Spanish messages and unknown codes to a readable fallback", async () => {
    commitmentsApi.dismissCandidate.mockRejectedValue({
      response: { data: { code: "candidate_changed", detail: "sensitive server detail" } },
    });
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.dismissCandidate("candidate-1"));
    expect(result.current.actionError).toBe("Esta propuesta cambió o ya no está disponible. Se cargó la evidencia más reciente.");
    expect(result.current.actionError).not.toContain("sensitive");

    expect(getCommitmentErrorMessage({ response: { data: { code: "unknown", detail: "private" } } }, i18n.getFixedT("es", "commitments")))
      .toBe("Algo salió mal. Inténtalo de nuevo.");
    expect(getCommitmentErrorMessage({ response: { data: { code: "change_proposal_changed" } } }))
      .toBe("This change proposal changed. The latest evidence and recommendation have been loaded.");
  });

  it("returns a Spanish load error that follows the language", async () => {
    commitmentsApi.getCandidates.mockRejectedValue({ response: { data: { code: "dimension_invalid" } } });
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loadError).toBe("Ese tipo de cambio ya no se puede revisar. Actualiza e inténtalo de nuevo.");
    await act(() => i18n.changeLanguage("en"));
    expect(result.current.loadError).toBe("That change type can no longer be reviewed. Refresh and try again.");
  });
});
