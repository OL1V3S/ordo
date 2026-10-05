import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commitmentsApi } from "../api/commitmentsApi";
import { englishT } from "../utils/formatCommitments";

// Stable backend codes with a localized message at `feedback.errors.<code>` in the
// commitments catalog. Anything else shows the generic `request_failed` message.
const ERROR_CODES = new Set([
  "candidate_changed",
  "candidate_dismissed",
  "confirmation_conflict",
  "fingerprint_invalid",
  "name_invalid",
  "category_invalid",
  "cadence_invalid",
  "timing_invalid",
  "amount_invalid",
  "lifecycle_invalid",
  "commitment_not_found",
  "dimension_invalid",
  "change_proposal_changed",
]);

const REFRESH_AFTER_ERROR = new Set([
  "candidate_changed",
  "candidate_dismissed",
  "confirmation_conflict",
  "commitment_not_found",
  "change_proposal_changed",
]);

// State holds catalog keys and the hook resolves them to the selected language when it
// returns them, so a displayed message follows a language change.
const errorKey = (error) => {
  const code = error?.response?.data?.code;
  return `feedback.errors.${ERROR_CODES.has(code) ? code : "request_failed"}`;
};

export function getCommitmentErrorMessage(error, t = englishT) {
  return t(errorKey(error));
}

export function useCommitments() {
  const { t } = useTranslation("commitments");
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
      if (currentRequestId === requestId.current) setLoadError(errorKey(error));
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
      setActionError(errorKey(error));
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
    loadError: loadError && t(loadError),
    actionError: actionError && t(actionError),
    notice: notice && t(notice),
    busyKey,
    refresh,
    clearMessages: () => {
      setActionError(null);
      setNotice(null);
    },
    dismissCandidate: (fingerprint) => perform(
      `dismiss:${fingerprint}`,
      () => commitmentsApi.dismissCandidate(fingerprint),
      "feedback.notices.dismissed"
    ),
    reconsiderCandidate: (fingerprint) => perform(
      `reconsider:${fingerprint}`,
      () => commitmentsApi.reconsiderCandidate(fingerprint),
      "feedback.notices.reconsidered"
    ),
    confirmCandidate: (payload) => perform(
      `confirm:${payload.fingerprint}`,
      () => commitmentsApi.confirmCandidate(payload),
      "feedback.notices.confirmed"
    ),
    updateCommitment: (id, payload) => perform(
      `update:${id}`,
      () => commitmentsApi.updateCommitment(id, payload),
      "feedback.notices.updated"
    ),
    updateLifecycle: (id, lifecycle) => perform(
      `lifecycle:${id}`,
      () => commitmentsApi.updateLifecycle(id, lifecycle),
      "feedback.notices.lifecycle"
    ),
    acceptAmountChange: (id, fingerprint) => perform(
      `change:amount:accept:${id}:${fingerprint}`,
      () => commitmentsApi.acceptAmountChange(id, fingerprint),
      "feedback.notices.amountAccepted"
    ),
    acceptTimingChange: (id, fingerprint) => perform(
      `change:timing:accept:${id}:${fingerprint}`,
      () => commitmentsApi.acceptTimingChange(id, fingerprint),
      "feedback.notices.timingAccepted"
    ),
    markEndedFromChange: (id, fingerprint) => perform(
      `change:missing:end:${id}:${fingerprint}`,
      () => commitmentsApi.markEndedFromChange(id, fingerprint),
      "feedback.notices.markedEnded"
    ),
    keepChange: (id, dimension, fingerprint) => perform(
      `change:${dimension}:keep:${id}:${fingerprint}`,
      () => commitmentsApi.keepChange(id, dimension, fingerprint),
      dimension === "missing" ? "feedback.notices.keptActive" : "feedback.notices.keptCurrent"
    ),
    reconsiderChange: (id, dimension, fingerprint) => perform(
      `change:${dimension}:reconsider:${id}:${fingerprint}`,
      () => commitmentsApi.reconsiderChange(id, dimension, fingerprint),
      "feedback.notices.changeReconsidered"
    ),
  };
}
