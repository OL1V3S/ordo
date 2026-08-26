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
};

const REFRESH_AFTER_ERROR = new Set([
  "candidate_changed",
  "candidate_dismissed",
  "confirmation_conflict",
  "commitment_not_found",
]);

export function getCommitmentErrorMessage(error) {
  const code = error?.response?.data?.code;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";
}

export function useCommitments() {
  const [candidates, setCandidates] = useState([]);
  const [dismissedCandidates, setDismissedCandidates] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const requestId = useRef(0);

  const refresh = useCallback(async ({ rethrow = false } = {}) => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [candidateResponse, commitmentResponse] = await Promise.all([
        commitmentsApi.getCandidates(),
        commitmentsApi.getCommitments(),
      ]);
      if (currentRequestId === requestId.current) {
        setCandidates(candidateResponse.data?.candidates ?? []);
        setDismissedCandidates(candidateResponse.data?.dismissedCandidates ?? []);
        setCommitments(commitmentResponse.data ?? []);
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
      setBusyKey(null);
    }
  }, [refresh]);

  return {
    candidates,
    dismissedCandidates,
    commitments,
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
  };
}
