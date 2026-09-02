import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitmentsApi } from "../api/commitmentsApi";
import { getCommitmentErrorMessage, useCommitments } from "./useCommitments";

vi.mock("../api/commitmentsApi", () => ({
  commitmentsApi: {
    getCandidates: vi.fn(),
    dismissCandidate: vi.fn(),
    reconsiderCandidate: vi.fn(),
    confirmCandidate: vi.fn(),
    getCommitments: vi.fn(),
    getChanges: vi.fn(),
    acceptAmountChange: vi.fn(),
    acceptTimingChange: vi.fn(),
    markEndedFromChange: vi.fn(),
    keepChange: vi.fn(),
    reconsiderChange: vi.fn(),
    updateCommitment: vi.fn(),
    updateLifecycle: vi.fn(),
  },
}));

describe("commitment state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitmentsApi.getCandidates.mockResolvedValue({
      data: { candidates: [{ fingerprint: "candidate-1" }], dismissedCandidates: [{ fingerprint: "dismissed-1" }] },
    });
    commitmentsApi.getCommitments.mockResolvedValue({ data: [{ id: "commitment-1" }] });
    commitmentsApi.getChanges.mockResolvedValue({
      data: { evaluatedOn: "2026-10-29", changes: [{ commitment: { id: "commitment-1" } }] },
    });
    commitmentsApi.confirmCandidate.mockResolvedValue({ data: { alreadyConfirmed: false } });
    commitmentsApi.dismissCandidate.mockResolvedValue({ data: null });
    commitmentsApi.acceptAmountChange.mockResolvedValue({ data: null });
    commitmentsApi.keepChange.mockResolvedValue({ data: null });
  });

  it("loads proposals, commitments, and change assessments together", async () => {
    const { result } = renderHook(() => useCommitments());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates).toEqual([{ fingerprint: "candidate-1" }]);
    expect(result.current.dismissedCandidates).toEqual([{ fingerprint: "dismissed-1" }]);
    expect(result.current.commitments).toEqual([{ id: "commitment-1" }]);
    expect(commitmentsApi.getChanges).toHaveBeenCalledTimes(1);
    expect(result.current.changeEvaluatedOn).toBe("2026-10-29");
    expect(result.current.commitmentChanges).toEqual([{ commitment: { id: "commitment-1" } }]);
  });

  it("confirms through the server and refreshes both collections", async () => {
    const payload = { fingerprint: "candidate-1", name: "Rent" };
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response;
    await act(async () => { response = await result.current.confirmCandidate(payload); });

    expect(commitmentsApi.confirmCandidate).toHaveBeenCalledWith(payload);
    expect(commitmentsApi.getCandidates).toHaveBeenCalledTimes(2);
    expect(commitmentsApi.getCommitments).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ alreadyConfirmed: false });
    expect(result.current.notice).toBe("Commitment confirmed.");
  });

  it("maps stable problem codes without exposing arbitrary server details", async () => {
    commitmentsApi.dismissCandidate.mockRejectedValue({
      response: { data: { code: "candidate_changed", detail: "sensitive server detail" } },
    });
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.dismissCandidate("candidate-1"));

    expect(result.current.actionError).toContain("proposal changed");
    expect(result.current.actionError).not.toContain("sensitive");
    expect(commitmentsApi.getCandidates).toHaveBeenCalledTimes(2);
    expect(commitmentsApi.getCommitments).toHaveBeenCalledTimes(2);
    expect(getCommitmentErrorMessage({ response: { data: { code: "unknown", detail: "private" } } }))
      .toBe("Something went wrong. Try again.");
  });

  it("refreshes every collection after a change action and maps stale proposals safely", async () => {
    commitmentsApi.acceptAmountChange.mockRejectedValue({
      response: { data: { code: "change_proposal_changed", detail: "private financial state" } },
    });
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.acceptAmountChange("commitment-1", "amount-fingerprint"));

    expect(commitmentsApi.acceptAmountChange).toHaveBeenCalledWith("commitment-1", "amount-fingerprint");
    expect(commitmentsApi.getCandidates).toHaveBeenCalledTimes(2);
    expect(commitmentsApi.getCommitments).toHaveBeenCalledTimes(2);
    expect(commitmentsApi.getChanges).toHaveBeenCalledTimes(2);
    expect(result.current.actionError).toContain("latest evidence");
    expect(result.current.actionError).not.toContain("private financial state");
  });

  it("prevents a second action while the first change decision is pending", async () => {
    let resolveAction;
    commitmentsApi.acceptAmountChange.mockReturnValue(new Promise((resolve) => { resolveAction = resolve; }));
    const { result } = renderHook(() => useCommitments());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first;
    let second;
    await act(async () => {
      first = result.current.acceptAmountChange("commitment-1", "amount-fingerprint");
      second = result.current.keepChange("commitment-1", "amount", "amount-fingerprint");
      resolveAction({ data: null });
      await Promise.all([first, second]);
    });

    expect(commitmentsApi.acceptAmountChange).toHaveBeenCalledTimes(1);
    expect(commitmentsApi.keepChange).not.toHaveBeenCalled();
  });
});
