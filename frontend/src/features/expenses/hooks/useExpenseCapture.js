import { useRef, useState } from "react";
import { getSessionSnapshot } from "../../../shared/auth/session";
import { normalizeText } from "../../../utils/text";
import { parseExpenseAmount } from "../utils/exactMoney";

const EMPTY_DRAFT = Object.freeze({
  description: "",
  amount: "",
  date: "",
  category: "",
  customCategory: "",
});

function focusAfterRender(target) {
  window.requestAnimationFrame(() => target()?.focus());
}

export function useExpenseCapture({
  createExpense,
  refresh,
  readUnavailable,
  isExternallyBlocked = () => false,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const writeInFlight = useRef(false);
  const opener = useRef(null);
  const inputRef = useRef(null);
  const feedbackRef = useRef(null);

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function openCreate(nextOpener) {
    opener.current = nextOpener ?? opener.current;
    setOpen(true);
    focusAfterRender(() => inputRef.current);
  }

  function closeCreate({ restoreFocus = true } = {}) {
    if (writeInFlight.current) return;
    setDraft(EMPTY_DRAFT);
    setOpen(false);
    if (restoreFocus) focusAfterRender(() => opener.current);
  }

  async function runMutation(action, kind, onSuccess) {
    if (isExternallyBlocked() || writeInFlight.current || recoveryRequired || readUnavailable) return;
    const session = getSessionSnapshot();
    writeInFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const result = await action();
      if (result?.stale || session !== getSessionSnapshot()) return;
      onSuccess?.();
      const refreshFailed = Boolean(result?.refreshFailed);
      setRecoveryRequired(refreshFailed);
      setFeedback({ tone: refreshFailed ? "warning" : "success", outcome: "completed", kind, refreshFailed });
    } catch {
      if (session !== getSessionSnapshot()) return;
      setRecoveryRequired(true);
      setFeedback({ tone: "danger", outcome: "unknown" });
    } finally {
      writeInFlight.current = false;
      if (session === getSessionSnapshot()) {
        setPending(false);
        focusAfterRender(() => feedbackRef.current);
      }
    }
  }

  function submitCreate() {
    const amount = parseExpenseAmount(draft.amount);
    if (!amount) return undefined;
    const category = draft.category === "other"
      ? normalizeText(draft.customCategory || "uncategorized")
      : normalizeText(draft.category);
    return runMutation(() => createExpense({
      description: normalizeText(draft.description),
      amount: amount.value,
      date: draft.date,
      category,
    }), "create", () => {
      setDraft(EMPTY_DRAFT);
      setOpen(false);
    });
  }

  async function refreshRecovery() {
    const session = getSessionSnapshot();
    try {
      const result = await refresh();
      if (result?.stale || session !== getSessionSnapshot()) return;
      const wasRecovering = recoveryRequired;
      setRecoveryRequired(false);
      setFeedback(wasRecovering ? { tone: "info", outcome: "refreshed" } : null);
    } catch {
      // A failed authoritative read cannot release an uncertain write.
    }
  }

  return {
    open,
    draft,
    pending,
    feedback,
    recoveryRequired,
    inputRef,
    feedbackRef,
    openCreate,
    closeCreate,
    updateDraft,
    submitCreate,
    runMutation,
    refreshRecovery,
    isWriteInFlight: () => writeInFlight.current,
  };
}
