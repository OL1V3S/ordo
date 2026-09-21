import { useRef, useState } from "react";
import { getSessionSnapshot } from "../../../shared/auth/session";
import { initialInflowDraft, validateInflow } from "../utils/inflowForm";

function focusAfterRender(target) {
  window.requestAnimationFrame(() => target()?.focus());
}

function invalidFields(errors) {
  return Object.fromEntries(Object.keys(errors).map((field) => [field, `${field}_invalid`]));
}

export function useInflowCapture({
  records = [],
  loading = false,
  error = null,
  refresh,
  createInflow,
  updateInflow,
  deleteInflow,
  isExternallyBlocked = () => false,
}) {
  const [task, setTask] = useState(null);
  const [pending, setPending] = useState(false);
  const [gate, setGate] = useState(null);
  const [checkedRead, setCheckedRead] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const writeInFlight = useRef(false);
  const taskLocked = useRef(false);
  const opener = useRef(null);
  const taskRef = useRef(null);
  const feedbackRef = useRef(null);
  const deleteButtonRef = useRef(null);
  const fallbackFocusRef = useRef(null);
  const readUnavailable = loading || Boolean(error);
  const targetMissing = Boolean(task?.record && !readUnavailable
    && !records.some((record) => record.id === task.record.id));
  taskLocked.current = Boolean(task || pending || gate);

  function focusTask() {
    focusAfterRender(() => taskRef.current?.querySelector("input")
      ?? deleteButtonRef.current ?? feedbackRef.current);
  }

  function openTask(type, record, nextOpener) {
    if (writeInFlight.current || taskLocked.current) {
      focusTask();
      return false;
    }
    if (readUnavailable) return false;
    taskLocked.current = true;
    opener.current = nextOpener;
    setFieldErrors({});
    setFeedback(null);
    setTask({ type, record, draft: type === "delete" ? null : initialInflowDraft(record) });
    if (type === "delete") focusAfterRender(() => deleteButtonRef.current);
    return true;
  }

  function cancelTask() {
    if (writeInFlight.current) return;
    setTask(null);
    setFieldErrors({});
    taskLocked.current = Boolean(gate);
    focusAfterRender(() => opener.current?.isConnected && !opener.current.disabled
      ? opener.current : fallbackFocusRef.current);
  }

  function updateDraft(draft) {
    setTask((current) => ({ ...current, draft }));
    setFieldErrors({});
  }

  async function refreshRecovery() {
    if (writeInFlight.current) return;
    const session = getSessionSnapshot();
    setCheckedRead(false);
    try {
      const result = await refresh();
      if (result?.stale || session !== getSessionSnapshot()) return;
      if (gate === "unknown") {
        setCheckedRead(true);
        setFeedback({ tone: "warning", outcome: "unknown_checked" });
      } else {
        const wasRecovering = Boolean(gate);
        setGate(null);
        if (wasRecovering) setFeedback({ tone: "info", outcome: "refreshed" });
      }
    } catch {
      // An unsuccessful authoritative read cannot release an uncertain write.
    }
  }

  function acknowledgeUnknown() {
    if (gate !== "unknown" || !checkedRead || readUnavailable || writeInFlight.current) return;
    setGate(null);
    setCheckedRead(false);
    setFeedback({ tone: "info", outcome: "retry_available" });
  }

  function setBlockedFeedback() {
    setFeedback({ tone: "info", outcome: "blocked" });
  }

  async function write(action, kind) {
    if (writeInFlight.current || gate || isExternallyBlocked() || readUnavailable) return;
    const session = getSessionSnapshot();
    writeInFlight.current = true;
    setPending(true);
    setFeedback(null);
    setFieldErrors({});
    let focusOutcome = true;
    try {
      const result = await action();
      if (result?.stale || session !== getSessionSnapshot()) return;
      setTask(null);
      const refreshFailed = Boolean(result?.refreshFailed);
      setGate(refreshFailed ? "refresh" : null);
      setFeedback({ tone: refreshFailed ? "warning" : "success", outcome: "completed", kind, refreshFailed, saved: true });
    } catch (requestError) {
      if (session !== getSessionSnapshot()) return;
      const status = requestError?.response?.status;
      if (status === 400) {
        const fields = requestError.response?.data?.errors;
        const errors = {};
        for (const field of ["description", "amount", "date"]) {
          if (fields && Object.keys(fields).some((key) => key.toLowerCase() === field)) {
            errors[field] = `${field}_invalid`;
          }
        }
        setFieldErrors(errors);
        focusOutcome = Object.keys(errors).length === 0;
        setFeedback({ tone: "danger", outcome: "validation" });
      } else if (status === 401 || status === 403) {
        setFeedback({ tone: "danger", outcome: status === 401 ? "unauthorized" : "forbidden" });
      } else {
        setGate(status === 404 ? "missing" : "unknown");
        setCheckedRead(false);
        setFeedback({ tone: "danger", outcome: status === 404 ? "missing" : "unknown" });
      }
    } finally {
      writeInFlight.current = false;
      if (session === getSessionSnapshot()) {
        setPending(false);
        if (focusOutcome) focusAfterRender(() => feedbackRef.current);
      }
    }
  }

  function submitTask() {
    if (!task || targetMissing) return;
    const { errors, payload } = validateInflow(task.draft);
    setFieldErrors(invalidFields(errors));
    if (!payload) return;
    return write(() => task.type === "create"
      ? createInflow(payload)
      : updateInflow(task.record.id, { id: task.record.id, ...payload }), task.type);
  }

  function deleteTask() {
    if (task?.type !== "delete" || targetMissing) return;
    return write(() => deleteInflow(task.record.id), "delete");
  }

  return {
    task,
    pending,
    gate,
    checkedRead,
    feedback,
    fieldErrors,
    readUnavailable,
    targetMissing,
    locked: Boolean(task || pending || gate),
    taskRef,
    feedbackRef,
    deleteButtonRef,
    fallbackFocusRef,
    openTask,
    cancelTask,
    updateDraft,
    submitTask,
    deleteTask,
    refreshRecovery,
    acknowledgeUnknown,
    setBlockedFeedback,
    focusTask,
    isWriteInFlight: () => writeInFlight.current,
  };
}
