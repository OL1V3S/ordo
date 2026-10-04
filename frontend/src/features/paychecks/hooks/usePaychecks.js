import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paychecksApi } from "../api/paychecksApi";
import { englishT } from "../utils/formatPaychecks";

// Stable backend/client codes with a localized message at `feedback.errors.<code>` in the
// paychecks catalog. Anything else shows the generic `request_failed` message.
const ERROR_CODES = new Set([
  "authentication_required", "paycheck_not_found", "candidate_changed", "candidate_dismissed",
  "confirmation_conflict", "candidate_schedule_mismatch", "fingerprint_invalid", "algorithm_version_invalid",
  "name_invalid", "cadence_invalid", "schedule_invalid", "timing_invalid", "amount_invalid", "lifecycle_invalid",
  "paycheck_not_active", "receipt_slot_invalid", "receipt_slot_unavailable", "receipt_source_invalid",
  "receipt_inflow_invalid", "receipt_inflow_unavailable", "receipt_conflict", "receipt_link_protected",
  "receipt_date_invalid", "request_invalid", "request_failed",
]);
const REFRESH_ERRORS = new Set(["candidate_changed", "candidate_dismissed", "confirmation_conflict", "paycheck_not_found"]);
// State holds catalog keys and the hook resolves them to the selected language when it
// returns them, so a displayed message follows a language change.
const UNCERTAIN_CREATE_MESSAGE = "feedback.uncertainCreate";
const UNCERTAIN_WRITE_MESSAGE = "feedback.uncertainWrite";

function errorCode(error) {
  if (error?.response?.status === 401) return "authentication_required";
  if (error?.response?.status === 404) return "paycheck_not_found";
  const code = error?.response?.data?.code;
  return ERROR_CODES.has(code) ? code : "request_failed";
}

const errorKey = (code) => `feedback.errors.${code}`;

export function getPaycheckErrorMessage(error, t = englishT) {
  return t(errorKey(errorCode(error)));
}

export function usePaychecks() {
  const { t } = useTranslation("paychecks");
  const [candidates, setCandidates] = useState([]);
  const [dismissedCandidates, setDismissedCandidates] = useState([]);
  const [paychecks, setPaychecks] = useState([]);
  const [candidatesEvaluatedOn, setCandidatesEvaluatedOn] = useState(null);
  const [paychecksEvaluatedOn, setPaychecksEvaluatedOn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [uncertainReceipt, setUncertainReceipt] = useState(false);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const readId = useRef(0);
  const initialSettled = useRef(false);
  const busyRef = useRef(null);
  const uncertainCreateRef = useRef(false);
  const uncertainReceiptRef = useRef(false);

  const load = useCallback(async () => {
    if (!mounted.current) return false;
    const id = ++readId.current;
    const current = () => mounted.current && id === readId.current;
    if (initialSettled.current) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const [candidateResponse, paycheckResponse] = await Promise.all([
        paychecksApi.getCandidates(), paychecksApi.getPaychecks(),
      ]);
      if (!current()) return false;
      setCandidates(candidateResponse.data.candidates);
      setDismissedCandidates(candidateResponse.data.dismissedCandidates);
      setCandidatesEvaluatedOn(candidateResponse.data.evaluatedOn);
      setPaychecks(paycheckResponse.data.paychecks);
      setPaychecksEvaluatedOn(paycheckResponse.data.evaluatedOn);
      if (uncertainCreateRef.current) {
        uncertainCreateRef.current = false;
        setUncertainCreate(false);
        setActionError((previous) => previous === UNCERTAIN_CREATE_MESSAGE ? null : previous);
        setNotice("feedback.uncertainCreateLoaded");
      }
      if (uncertainReceiptRef.current) {
        uncertainReceiptRef.current = false;
        setUncertainReceipt(false);
        setActionError((previous) => previous === UNCERTAIN_WRITE_MESSAGE ? null : previous);
        setNotice("feedback.uncertainReceiptLoaded");
      }
      return true;
    } catch (error) {
      if (current()) setLoadError(errorCode(error) === "authentication_required"
        ? errorKey("authentication_required")
        : "feedback.loadFailed");
      return false;
    } finally {
      if (current()) {
        initialSettled.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      lifetime.current += 1;
      readId.current += 1;
    };
  }, [load]);

  const refresh = useCallback(() => busyRef.current ? Promise.resolve(false) : load(), [load]);

  const perform = useCallback(async (key, operation, successMessage, uncertaintyKind = null) => {
    if (!mounted.current) return { ok: false, code: "unmounted" };
    if (busyRef.current) return { ok: false, code: "busy" };
    if (!initialSettled.current) return { ok: false, code: "loading" };
    if (uncertaintyKind === "create" && uncertainCreateRef.current)
      return { ok: false, code: "creation_uncertain", uncertain: true };
    if (uncertaintyKind === "receipt" && uncertainReceiptRef.current)
      return { ok: false, code: "receipt_uncertain", uncertain: true };
    const epoch = lifetime.current;
    const current = () => mounted.current && lifetime.current === epoch;
    busyRef.current = key;
    // A read started before this mutation must not overwrite its subsequent refresh.
    readId.current += 1;
    setRefreshing(false);
    setBusyKey(key);
    if (!uncertainCreateRef.current) setActionError(null);
    setNotice(null);
    try {
      const response = await operation();
      if (!current()) return { ok: true, data: response.data, refreshOk: false };
      setNotice(successMessage);
      // A known successful write remains successful even if the following read fails.
      const refreshOk = await load();
      return { ok: true, data: response.data, refreshOk };
    } catch (error) {
      if (!current()) return { ok: false, code: "unmounted" };
      const uncertain = !error?.response || error.response.status >= 500;
      if (uncertain) {
        if (uncertaintyKind === "create") {
          uncertainCreateRef.current = true;
          setUncertainCreate(true);
        }
        if (uncertaintyKind === "receipt") {
          uncertainReceiptRef.current = true;
          setUncertainReceipt(true);
        }
        setActionError(uncertaintyKind === "create" ? UNCERTAIN_CREATE_MESSAGE : UNCERTAIN_WRITE_MESSAGE);
        return { ok: false, code: uncertaintyKind === "create" ? "creation_uncertain"
          : uncertaintyKind === "receipt" ? "receipt_uncertain" : "write_uncertain", uncertain: true };
      }
      const code = errorCode(error);
      setActionError(errorKey(code));
      if (REFRESH_ERRORS.has(code) || error.response.status === 409) {
        const refreshOk = await load();
        return { ok: false, code, refreshOk };
      }
      return { ok: false, code };
    } finally {
      if (current()) {
        busyRef.current = null;
        setBusyKey(null);
      }
    }
  }, [load]);

  const clearMessages = useCallback(() => {
    if (!mounted.current) return;
    setActionError(uncertainCreateRef.current ? UNCERTAIN_CREATE_MESSAGE
      : uncertainReceiptRef.current ? UNCERTAIN_WRITE_MESSAGE : null);
    setNotice(null);
  }, []);

  const acknowledgeUncertainCreate = useCallback(() => {
    if (!mounted.current || busyRef.current) return;
    uncertainCreateRef.current = false;
    setUncertainCreate(false);
    setActionError(null);
  }, []);

  return {
    candidates, dismissedCandidates, paychecks, candidatesEvaluatedOn, paychecksEvaluatedOn,
    loading, refreshing, loadError: loadError && t(loadError), actionError: actionError && t(actionError),
    notice: notice && t(notice), busyKey, uncertainCreate, uncertainReceipt,
    refresh, clearMessages, acknowledgeUncertainCreate,
    confirmCandidate: (payload) => perform(`confirm:${payload.fingerprint}`,
      () => paychecksApi.confirmCandidate(payload), "feedback.notices.confirmed"),
    dismissCandidate: (tuple) => perform(`dismiss:${tuple.fingerprint}`,
      () => paychecksApi.dismissCandidate(tuple), "feedback.notices.dismissed"),
    reconsiderCandidate: (tuple) => perform(`reconsider:${tuple.fingerprint}`,
      () => paychecksApi.reconsiderCandidate(tuple), "feedback.notices.reconsidered"),
    createPaycheck: (payload) => perform("create", () => paychecksApi.createPaycheck(payload), "feedback.notices.created", "create"),
    updatePaycheck: (id, payload) => perform(`update:${id}`,
      () => paychecksApi.updatePaycheck(id, payload), "feedback.notices.updated"),
    updateLifecycle: (id, lifecycle) => perform(`lifecycle:${id}`,
      () => paychecksApi.updateLifecycle(id, lifecycle), "feedback.notices.lifecycle"),
    recordReceipt: (id, payload) => perform(`receipt:${id}`,
      () => paychecksApi.recordReceipt(id, payload), "feedback.notices.receiptRecorded", "receipt"),
    removeReceipt: (id, accountInflowId) => perform(`unlink:${id}:${accountInflowId}`,
      () => paychecksApi.removeReceipt(id, accountInflowId), "feedback.notices.receiptRemoved"),
  };
}
