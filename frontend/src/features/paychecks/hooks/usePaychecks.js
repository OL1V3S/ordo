import { useCallback, useEffect, useRef, useState } from "react";
import { paychecksApi } from "../api/paychecksApi";

const ERROR_MESSAGES = {
  authentication_required: "Your session has expired. Sign in again to manage paychecks.",
  paycheck_not_found: "That paycheck is no longer available. Review the current profiles.",
  candidate_changed: "This candidate changed or is no longer available. Review the latest evidence before trying again.",
  candidate_dismissed: "This candidate was dismissed. Reconsider it before confirming.",
  confirmation_conflict: "The evidence changed during confirmation. Review the latest evidence before trying again.",
  candidate_schedule_mismatch: "The candidate schedule cannot be changed. Review it again or create a manual paycheck.",
  fingerprint_invalid: "This candidate can no longer be reviewed. Refresh the candidates.",
  algorithm_version_invalid: "This candidate version is invalid. Refresh the candidates.",
  name_invalid: "Enter a nonblank paycheck name of 500 characters or fewer.",
  cadence_invalid: "Choose a valid paycheck cadence.",
  schedule_invalid: "Enter a complete, valid paycheck schedule.",
  timing_invalid: "Enter whole timing windows from zero to three days.",
  amount_invalid: "Enter a positive fixed amount or increasing range, with at most two decimal places.",
  lifecycle_invalid: "Choose active, paused, or ended.",
  paycheck_not_active: "Only an active paycheck can record a new receipt.",
  receipt_slot_invalid: "Choose an available paycheck date.",
  receipt_slot_unavailable: "That paycheck date is no longer available. Review the refreshed profile.",
  receipt_source_invalid: "Choose either new cash in or an existing cash-in record.",
  receipt_inflow_invalid: "Enter a valid description, positive amount, and date.",
  receipt_inflow_unavailable: "That cash-in record is unavailable or already linked. Review the refreshed records.",
  receipt_conflict: "That receipt changed or was claimed. Review the refreshed paycheck.",
  receipt_link_protected: "Confirmation-history links cannot be removed here.",
  receipt_date_invalid: "The observed date is too far from the selected paycheck date.",
  request_invalid: "Check the form fields and try again.",
  request_failed: "The request could not be completed. Try again.",
};
const REFRESH_ERRORS = new Set(["candidate_changed", "candidate_dismissed", "confirmation_conflict", "paycheck_not_found"]);
const UNCERTAIN_CREATE_MESSAGE = "We could not confirm whether the paycheck was created. Refresh and check the saved profiles before intentionally trying again.";
const UNCERTAIN_WRITE_MESSAGE = "We could not confirm the outcome of this action. Refresh and check the current state before trying again.";

function errorCode(error) {
  if (error?.response?.status === 401) return "authentication_required";
  if (error?.response?.status === 404) return "paycheck_not_found";
  const code = error?.response?.data?.code;
  return Object.hasOwn(ERROR_MESSAGES, code) ? code : "request_failed";
}

export function getPaycheckErrorMessage(error) {
  return ERROR_MESSAGES[errorCode(error)];
}

export function usePaychecks() {
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
        setNotice("Paychecks loaded. Check the saved profiles before intentionally trying to create another paycheck.");
      }
      if (uncertainReceiptRef.current) {
        uncertainReceiptRef.current = false;
        setUncertainReceipt(false);
        setActionError((previous) => previous === UNCERTAIN_WRITE_MESSAGE ? null : previous);
        setNotice("Paychecks loaded. Check the linked deposits before intentionally recording another receipt.");
      }
      return true;
    } catch (error) {
      if (current()) setLoadError(errorCode(error) === "authentication_required"
        ? ERROR_MESSAGES.authentication_required
        : "Paychecks could not be loaded. Refresh to try again; the displayed information may be out of date.");
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
      setActionError(ERROR_MESSAGES[code]);
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
    loading, refreshing, loadError, actionError, notice, busyKey, uncertainCreate, uncertainReceipt,
    refresh, clearMessages, acknowledgeUncertainCreate,
    confirmCandidate: (payload) => perform(`confirm:${payload.fingerprint}`,
      () => paychecksApi.confirmCandidate(payload), "Paycheck confirmed."),
    dismissCandidate: (tuple) => perform(`dismiss:${tuple.fingerprint}`,
      () => paychecksApi.dismissCandidate(tuple), "Candidate dismissed. You can reconsider it below."),
    reconsiderCandidate: (tuple) => perform(`reconsider:${tuple.fingerprint}`,
      () => paychecksApi.reconsiderCandidate(tuple), "Candidate reconsidered."),
    createPaycheck: (payload) => perform("create", () => paychecksApi.createPaycheck(payload), "Paycheck created.", "create"),
    updatePaycheck: (id, payload) => perform(`update:${id}`,
      () => paychecksApi.updatePaycheck(id, payload), "Paycheck updated."),
    updateLifecycle: (id, lifecycle) => perform(`lifecycle:${id}`,
      () => paychecksApi.updateLifecycle(id, lifecycle), "Paycheck status updated."),
    recordReceipt: (id, payload) => perform(`receipt:${id}`,
      () => paychecksApi.recordReceipt(id, payload), "Paycheck received. Actual cash in is now linked.", "receipt"),
    removeReceipt: (id, accountInflowId) => perform(`unlink:${id}:${accountInflowId}`,
      () => paychecksApi.removeReceipt(id, accountInflowId), "Paycheck link removed. The cash-in record remains in Activity."),
  };
}
