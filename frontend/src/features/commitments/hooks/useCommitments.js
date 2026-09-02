import { useCallback, useEffect, useRef, useState } from "react";
import { commitmentsApi } from "../api/commitmentsApi";

const ERROR_MESSAGES = {
  candidate_changed: "This proposal changed or is no longer available. The latest evidence has been loaded.",
  candidate_dismissed: "Reconsider this proposal before confirming it.",
  confirmation_conflict: "This proposal changed while it was being confirmed. The latest state has been loaded.",
  fingerprint_invalid: "This proposal can no longer be reviewed. Refresh and try again.",
  name_invalid: "Enter a commitment name of 500 characters or fewer.",
  category_invalid: "Enter a valid category of 100 characters or fewer.",
  cadence_invalid: "Choose a valid commitment cadence.",
  timing_invalid: "Choose timing details that match the cadence.",
  amount_invalid: "Enter a valid fixed amount or amount range.",
  lifecycle_invalid: "Choose active, paused, or ended.",
  commitment_not_found: "That commitment is no longer available.",
  dimension_invalid: "That change type can no longer be reviewed. Refresh and try again.",
  change_proposal_changed: "This change proposal changed. The latest evidence and recommendation have been loaded.",
};

const REFRESH_AFTER_ERROR = new Set([
  "candidate_changed",
  "candidate_dismissed",
  "confirmation_conflict",
  "commitment_not_found",
  "change_proposal_changed",
]);

export function getCommitmentErrorMessage(error) {
  const code = error?.response?.data?.code;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";
}

export function useCommitments() {
  const [candidates, setCandidates] = useState([]);
  const [dismissedCandidates, setDismissedCandidates] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [commitmentChanges, setCommitmentChanges] = useState([]);
  const [changeEvaluatedOn, setChangeEvaluatedOn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const requestId = useRef(0);
  const busyRef = useRef(null);
  const refresh = useCallback(async ({ rethrow = false } = {}) => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const requests = [
        commitmentsApi.getCandidates(),
        commitmentsApi.getCommitments(),
        commitmentsApi.getChanges(),
      ];
      const [candidateResponse, commitmentResponse, changeResponse] = await Promise.all(requests);
      if (currentRequestId === requestId.current) {
        setCandidates(candidateResponse.data?.candidates ?? []);
        setDismissedCandidates(candidateResponse.data?.dismissedCandidates ?? []);
        setCommitments(commitmentResponse.data ?? []);
        setCommitmentChanges(changeResponse?.data?.changes ?? []);
        setChangeEvaluatedOn(changeResponse?.data?.evaluatedOn ?? null);
      }
      return true;
    } catch (error) {
      if (currentRequestId === requestId.current) setLoadError(getCommitmentErrorMessage(error));
      if (rethrow) throw error;
      return false;
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  const perform = useCallback(async (key, operation, successMessage) => {
    if (busyRef.current) return null;
    busyRef.current = key;
    setBusyKey(key);
    setActionError(null);
    setNotice(null);
    try {
      const response = await operation();
      await refresh({ rethrow: true });
      setNotice(successMessage);
      return response.data;
    } catch (error) {
      if (REFRESH_AFTER_ERROR.has(error?.response?.data?.code)) await refresh();
      setActionError(getCommitmentErrorMessage(error));
      return null;
    } finally {
      busyRef.current = null;
      setBusyKey(null);
    }
  }, [refresh]);

  return {
    candidates,
    dismissedCandidates,
    commitments,
    commitmentChanges,
    changeEvaluatedOn,
    loading,
    loadError,
    actionError,
    notice,
    busyKey,
    refresh,
    clearMessages: () => {
      setActionError(null);
      setNotice(null);
    },
    dismissCandidate: (fingerprint) => perform(
      `dismiss:${fingerprint}`,
      () => commitmentsApi.dismissCandidate(fingerprint),
      "Proposal dismissed. You can reconsider it below."
    ),
    reconsiderCandidate: (fingerprint) => perform(
      `reconsider:${fingerprint}`,
      () => commitmentsApi.reconsiderCandidate(fingerprint),
      "Proposal returned to your review list."
    ),
    confirmCandidate: (payload) => perform(
      `confirm:${payload.fingerprint}`,
      () => commitmentsApi.confirmCandidate(payload),
      "Commitment confirmed."
    ),
    updateCommitment: (id, payload) => perform(
      `update:${id}`,
      () => commitmentsApi.updateCommitment(id, payload),
      "Commitment updated."
    ),
    updateLifecycle: (id, lifecycle) => perform(
      `lifecycle:${id}`,
      () => commitmentsApi.updateLifecycle(id, lifecycle),
      "Commitment status updated."
    ),
    acceptAmountChange: (id, fingerprint) => perform(
      `change:amount:accept:${id}:${fingerprint}`,
      () => commitmentsApi.acceptAmountChange(id, fingerprint),
      "Amount expectation updated."
    ),
    acceptTimingChange: (id, fingerprint) => perform(
      `change:timing:accept:${id}:${fingerprint}`,
      () => commitmentsApi.acceptTimingChange(id, fingerprint),
      "Timing expectation updated."
    ),
    markEndedFromChange: (id, fingerprint) => perform(
      `change:missing:end:${id}:${fingerprint}`,
      () => commitmentsApi.markEndedFromChange(id, fingerprint),
      "Commitment marked ended."
    ),
    keepChange: (id, dimension, fingerprint) => perform(
      `change:${dimension}:keep:${id}:${fingerprint}`,
      () => commitmentsApi.keepChange(id, dimension, fingerprint),
      dimension === "missing" ? "Commitment kept active." : "Current expectation kept."
    ),
    reconsiderChange: (id, dimension, fingerprint) => perform(
      `change:${dimension}:reconsider:${id}:${fingerprint}`,
      () => commitmentsApi.reconsiderChange(id, dimension, fingerprint),
      "Change returned to your review list."
    ),
  };
}
