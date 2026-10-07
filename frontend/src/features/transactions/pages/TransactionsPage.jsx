import { useEffect, useMemo, useRef, useState } from "react";
import { useExpenses } from "../../expenses/hooks/useExpenses";
import { useExpenseCapture } from "../../expenses/hooks/useExpenseCapture";
import { filterExpenses } from "../../expenses/utils/filterExpenses";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { normalizeText, isDefaultCategory } from "../../../utils/text";
import ExpenseForm from "../../expenses/components/ExpenseForm";
import ExpenseFilters from "../../expenses/components/ExpenseFilters";
import ExpenseList from "../../expenses/components/ExpenseList";
import ImportPreviewPanel from "../../importPreview/components/ImportPreviewPanel";
import { useImportPreview } from "../../importPreview/hooks/useImportPreview";
import { useInflows } from "../../inflows/hooks/useInflows";
import { useInflowCapture } from "../../inflows/hooks/useInflowCapture";
import InflowForm from "../../inflows/components/InflowForm";
import InflowList from "../../inflows/components/InflowList";
import { isUnsafeAmount, formatInflowDate } from "../../inflows/utils/inflowForm";
import { useCaptureRecovery } from "../../home/recovery/captureRecovery";
import { useTranslation } from "react-i18next";
import { useActivityTimeline } from "../../activity/hooks/useActivityTimeline";
import { useTimelineFilters } from "../../activity/hooks/useTimelineFilters";
import ActivityTimeline from "../../activity/components/ActivityTimeline";
import { parseExpenseAmount } from "../../expenses/utils/exactMoney";
import StatusMessage from "../../../shared/ui/StatusMessage";
import "../../../styles/activity.css";
import "../../../styles/inflows.css";

const ENTRIES_PER_PAGE = 10;
function focusAfterRender(target) {
  window.requestAnimationFrame(() => target()?.focus());
}
// The timeline is a read-only view whose row actions hand off to the per-type flows, and it recovers independently of the per-type lists, so a refresh
// request never throws into, delays, or changes the outcome of a write or list refresh.
function requestTimelineRefresh(refresh) {
  try { Promise.resolve(refresh?.()).catch(() => {}); } catch { /* Timeline failures never affect the lists. */ }
}

const INFLOW_FIELD_MESSAGE_KEYS = {
  description_invalid: "cashIn.fieldErrors.description",
  amount_invalid: "cashIn.fieldErrors.amount",
  date_invalid: "cashIn.fieldErrors.date",
};
const EXPENSE_COMPLETED_KEYS = { create: "created", update: "updated", delete: "deleted" };
const INFLOW_COMPLETED_KEYS = { create: "created", edit: "updated", delete: "deleted" };
const INFLOW_OUTCOME_KEYS = {
  validation: "validation",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  missing: "missing",
  unknown: "unknown",
  unknown_checked: "unknownChecked",
  refreshed: "refreshed",
  retry_available: "retryAvailable",
  blocked: "blocked",
};

function expenseFeedbackMessage(feedback, t) {
  if (!feedback) return "";
  if (feedback.outcome === "unknown") return t("spending.feedback.unknown");
  if (feedback.outcome === "missing") return t("spending.feedback.missing");
  if (feedback.outcome === "refreshed") return t("spending.feedback.refreshed");
  const completed = EXPENSE_COMPLETED_KEYS[feedback.kind];
  return t(`spending.feedback.${completed}${feedback.refreshFailed ? "RefreshFailed" : ""}`);
}

function inflowFeedbackMessage(feedback, t) {
  if (!feedback) return "";
  if (feedback.outcome === "completed") {
    const completed = INFLOW_COMPLETED_KEYS[feedback.kind];
    return t(`cashIn.feedback.${completed}${feedback.refreshFailed ? "RefreshFailed" : ""}`);
  }
  const key = INFLOW_OUTCOME_KEYS[feedback.outcome];
  return key ? t(`cashIn.feedback.${key}`) : undefined;
}

export default function TransactionsPage() {
  const { t } = useTranslation("home");
  const { t: ta } = useTranslation("activity");
  const captureRecovery = useCaptureRecovery();
  const timelineEnabled = !captureRecovery.source;
  const timelineFilters = useTimelineFilters();
  const timeline = useActivityTimeline({ enabled: timelineEnabled, filter: timelineFilters.applied });
  const timelineRefresh = useRef(timeline.refresh);
  timelineRefresh.current = timeline.refresh;
  const withTimelineRefresh = (write) => async (...args) => {
    const result = await write(...args);
    if (!result?.stale) requestTimelineRefresh(timelineRefresh.current);
    return result;
  };
  const withTimelineReadRefresh = (read) => async (...args) => {
    try { return await read(...args); } finally { requestTimelineRefresh(timelineRefresh.current); }
  };
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const importState = useImportPreview();
  const cash = useInflows();
  const [cashSearch, setCashSearch] = useState("");
  const [cashShowAll, setCashShowAll] = useState(false);
  const cashLock = useRef(false);
  const legacyLock = useRef(false);
  const cashAddButton = useRef(null);
  const {
    expenses, loading: expensesLoading, error: expensesError,
    refresh: refreshExpenses, addExpense, updateExpense, deleteExpense,
  } = useExpenses();
  const [importOpen, setImportOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingExpenseData, setEditingExpenseData] = useState({});
  const [dateFilter, setDateFilter] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAll, setShowAll] = useState(false);
  const addButton = useRef(null);
  const importButton = useRef(null);
  const importRegion = useRef(null);
  const editButton = useRef(null);
  const activityHeading = useRef(null);
  const recoveryRegion = useRef(null);
  const updateExpenseAndTimeline = withTimelineRefresh(updateExpense);
  const deleteExpenseAndTimeline = withTimelineRefresh(deleteExpense);
  const expenseCapture = useExpenseCapture({
    createExpense: withTimelineRefresh(addExpense),
    refresh: withTimelineReadRefresh(refreshExpenses),
    readUnavailable: expensesLoading || Boolean(expensesError),
    isExternallyBlocked: () => cashLock.current || Boolean(captureRecovery.source),
  });
  const inflowCapture = useInflowCapture({
    records: cash.inflows,
    loading: cash.loading,
    error: cash.error,
    refresh: withTimelineReadRefresh(cash.refresh),
    createInflow: withTimelineRefresh(cash.createInflow),
    updateInflow: withTimelineRefresh(cash.updateInflow),
    deleteInflow: withTimelineRefresh(cash.deleteInflow),
    isExternallyBlocked: () => legacyLock.current || Boolean(captureRecovery.source),
  });
  // An unknown in-page write outcome may or may not have changed the records: re-read the
  // timeline and tell the user it may be out of date while that uncertainty is unresolved.
  const timelineUncertain = expenseCapture.recoveryRequired
    || inflowCapture.gate === "unknown" || inflowCapture.gate === "refresh" || inflowCapture.gate === "missing";
  useEffect(() => {
    if (timelineUncertain) requestTimelineRefresh(timelineRefresh.current);
  }, [timelineUncertain]);

  const expensesById = useMemo(() => new Map(expenses.map((record) => [record.id, record])), [expenses]);
  const inflowsById = useMemo(() => new Map(cash.inflows.map((record) => [record.id, record])), [cash.inflows]);
  const filters = useMemo(() => ({
    dateFilter, customStartDate, customEndDate, categoryFilter, searchTerm,
  }), [dateFilter, customStartDate, customEndDate, categoryFilter, searchTerm]);
  const filteredExpenses = useMemo(() => filterExpenses(expenses, filters), [expenses, filters]);
  useEffect(() => { setShowAll(false); }, [filters]);
  const recoveringExpenses = captureRecovery.source === "expense";
  const recoveringCashIn = captureRecovery.source === "account_inflow";
  const visibleExpenses = recoveringExpenses ? expenses : showAll ? filteredExpenses : filteredExpenses.slice(0, ENTRIES_PER_PAGE);
  // A filter, pagination reset, or failed refresh must not remove an open draft.
  const editIsPinned = editingExpense && !visibleExpenses.some((expense) => expense.id === editingExpense.id);
  const expensesToShow = editIsPinned ? [editingExpense, ...visibleExpenses] : visibleExpenses;
  const resumingImport = new URLSearchParams(window.location.search).has("importBatch");
  const importMustStayVisible = Boolean(importState.preview || importState.processing
    || (importState.loading && (resumingImport || importState.sourceType)) || importState.confirming || importState.error
    || importState.confirmation || importState.confirmationIssue);
  const showImport = importOpen || importMustStayVisible;
  const cashLocked = inflowCapture.locked;
  cashLock.current = cashLocked;
  const legacyBlocked = Boolean(captureRecovery.source || expenseCapture.open || editingExpense || expenseCapture.pending || expenseCapture.recoveryRequired
    || (importOpen && !importState.confirmation) || importState.preview || importState.processing
    || importState.confirming || importState.loading || importState.error || importState.confirmationIssue);
  legacyLock.current = legacyBlocked;
  const cashReadUnavailable = inflowCapture.readUnavailable;
  const filteredCash = recoveringCashIn ? cash.inflows : cash.inflows.filter((record) => record.description.toLowerCase().includes(cashSearch.trim().toLowerCase()));
  const visibleCash = recoveringCashIn ? cash.inflows : cashShowAll ? filteredCash : filteredCash.slice(0, ENTRIES_PER_PAGE);
  const cashPinned = inflowCapture.task?.record && !visibleCash.some((record) => record.id === inflowCapture.task.record.id);
  const cashRows = cashPinned ? [inflowCapture.task.record, ...visibleCash] : visibleCash;
  const inflowFieldErrors = Object.fromEntries(Object.entries(inflowCapture.fieldErrors)
    .map(([field, code]) => [field, INFLOW_FIELD_MESSAGE_KEYS[code] ? ta(INFLOW_FIELD_MESSAGE_KEYS[code]) : code]));
  useEffect(() => { setCashShowAll(false); }, [cashSearch]);
  const recoveryReady = recoveringExpenses ? !expensesLoading && !expensesError
    : recoveringCashIn ? !cash.loading && !cash.error : false;
  const recoveryLoading = recoveringExpenses ? expensesLoading : recoveringCashIn ? cash.loading : false;
  const recoveryError = recoveringExpenses ? expensesError : recoveringCashIn ? cash.error : false;
  useEffect(() => {
    if (!captureRecovery.source) return undefined;
    const frame = window.requestAnimationFrame(() => recoveryRegion.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [captureRecovery.source]);
  async function retryRecoveryList() {
    try {
      if (recoveringExpenses) await refreshExpenses();
      else if (recoveringCashIn) await cash.refresh();
    } catch { /* Keep the marker until a successful full-list read and explicit acknowledgment. */ }
  }
  function acknowledgeRecovery() {
    if (!recoveryReady) return;
    captureRecovery.clear();
    setRecoveryAcknowledged(true);
    focusAfterRender(() => recoveringExpenses ? activityHeading.current : inflowCapture.fallbackFocusRef.current);
  }

  function openCashTask(type, record, opener) {
    if (cashLock.current || inflowCapture.isWriteInFlight()) { inflowCapture.focusTask(); return; }
    if (legacyLock.current) {
      inflowCapture.setBlockedFeedback?.();
      focusAfterRender(() => expenseCapture.open ? expenseCapture.inputRef.current : editingExpense
        ? document.querySelector(`[aria-label="${ta("expenseItem.editDescription")}"]`) : importRegion.current);
      return;
    }
    if (cashReadUnavailable) return;
    cashLock.current = true;
    inflowCapture.openTask(type, record, opener);
  }
  async function refreshImportedActivity(result) {
    if (result.importedExpenseCount > 0 || result.importedInflowCount > 0) requestTimelineRefresh(timelineRefresh.current);
    const requests = [];
    if (result.importedExpenseCount > 0) requests.push({ name: "expenses", request: refreshExpenses() });
    if (result.importedInflowCount > 0) requests.push({ name: "cashIn", request: cash.refresh() });
    const outcomes = await Promise.allSettled(requests.map(({ request }) => request));
    return { failedLists: requests.filter((_, index) => outcomes[index].status === "rejected").map(({ name }) => name) };
  }

  function openAdd() {
    if (cashLock.current) { inflowCapture.focusTask(); return; }
    legacyLock.current = true;
    expenseCapture.openCreate(addButton.current);
  }
  function startEditExpense(expense, opener) {
    if (cashLock.current || editingExpense || expenseCapture.isWriteInFlight()) return;
    const currentCategory = expense.category || "";
    const amount = parseExpenseAmount(expense.amount);
    if (!amount) return;
    legacyLock.current = true;
    const categoryIsDefault = isDefaultCategory(currentCategory, DEFAULT_CATEGORIES);
    editButton.current = opener;
    setEditingExpense(expense);
    setEditingExpenseData({
      description: expense.description || "",
      amount: amount.value,
      date: expense.date || "",
      category: categoryIsDefault ? normalizeText(currentCategory) : "other",
      customCategory: categoryIsDefault ? "" : currentCategory,
    });
  }
  // The edited record no longer exists: close the edit without returning focus to its opener,
  // because focus moves to the feedback region.
  function closeMissingExpenseEdit() {
    setEditingExpense(null);
    setEditingExpenseData({});
  }
  function cancelEditExpense() {
    setEditingExpense(null);
    setEditingExpenseData({});
    focusAfterRender(() => editButton.current?.isConnected ? editButton.current : activityHeading.current);
  }
  async function saveExpenseEdit(id) {
    const amount = parseExpenseAmount(editingExpenseData.amount);
    if (!amount) return;
    const finalCategory = editingExpenseData.category === "other"
      ? normalizeText(editingExpenseData.customCategory || "uncategorized")
      : normalizeText(editingExpenseData.category);
    await expenseCapture.runMutation(() => updateExpenseAndTimeline(id, {
      id, description: normalizeText(editingExpenseData.description),
      amount: amount.value,
      date: editingExpenseData.date, category: finalCategory,
    }), "update", cancelEditExpense, { onMissing: closeMissingExpenseEdit });
  }
  const expenseActionsUnavailable = expenseCapture.pending || Boolean(captureRecovery.source) || cashLocked
    || Boolean(editingExpense) || expensesLoading || Boolean(expensesError) || expenseCapture.recoveryRequired;
  const timelineRowActions = {
    getState(item) {
      if (item.kind === "expense") {
        const record = expensesById.get(item.recordId);
        const blocked = !record || expenseActionsUnavailable;
        return { canEdit: !blocked && Boolean(parseExpenseAmount(record.amount)), canDelete: !blocked };
      }
      const blocked = !inflowsById.has(item.recordId) || cashLocked || legacyBlocked || cashReadUnavailable;
      return { canEdit: !blocked, canDelete: !blocked };
    },
    onEdit(item, opener) {
      if (item.kind === "expense") {
        const record = expensesById.get(item.recordId);
        if (record) startEditExpense(record, opener);
      } else {
        const record = inflowsById.get(item.recordId);
        if (record) openCashTask("edit", record, opener);
      }
    },
    onDelete(item, opener) {
      if (item.kind === "expense") {
        const record = expensesById.get(item.recordId);
        if (record) void handleDeleteExpense(record.id);
      } else {
        const record = inflowsById.get(item.recordId);
        if (record) openCashTask("delete", record, opener);
      }
    },
  };
  async function handleDeleteExpense(id) {
    if (cashLock.current || expenseCapture.isWriteInFlight() || !window.confirm(ta("spending.deleteConfirm"))) return;
    await expenseCapture.runMutation(() => deleteExpenseAndTimeline(id), "delete", undefined, { onMissing: closeMissingExpenseEdit });
  }

  return (
    <div className="container activity-page">
      <header className="page-header">
        <div><h1>{ta("page.title")}</h1><p className="muted">{ta("page.intro")}</p></div>
        <div className="inline-actions activity-task-openers">
          <button type="button" ref={addButton} disabled={Boolean(captureRecovery.source)} aria-expanded={expenseCapture.open} aria-controls="add-expense-task" onClick={openAdd}>
            {ta("page.addExpense")}
          </button>
          <button type="button" ref={cashAddButton} aria-expanded={inflowCapture.task?.type === "create"} aria-controls="cash-in-task"
            disabled={cashReadUnavailable || inflowCapture.pending || Boolean(inflowCapture.gate) || Boolean(captureRecovery.source)}
            onClick={(event) => openCashTask("create", null, event.currentTarget)}>{ta("page.addCashIn")}</button>
          <button type="button" className="button-ghost" ref={importButton} disabled={Boolean(captureRecovery.source)} aria-expanded={showImport} aria-controls="statement-import-task"
            onClick={() => { if (cashLock.current) { inflowCapture.focusTask(); return; } legacyLock.current = true; setImportOpen(true); focusAfterRender(() => importRegion.current); }}>
            {ta("page.importStatement")}
          </button>
        </div>
      </header>
      <nav className="activity-section-links" aria-label={ta("nav.label")}>
        {timelineEnabled && <a href="#activity-timeline-heading">{ta("nav.timeline")}</a>}
        <a href="#spending-activity-heading">{ta("nav.spending")}</a><a href="#cash-in-heading">{ta("nav.cashIn")}</a>
      </nav>
      {captureRecovery.source && <section ref={recoveryRegion} tabIndex={-1} className="card home-recovery" role="region" aria-labelledby="capture-recovery-heading">
        <h2 id="capture-recovery-heading">{t("recovery.heading")}</h2>
        <p>{t(recoveringExpenses ? "recovery.activityBannerExpense" : "recovery.activityBannerCashIn")}</p>
        {captureRecovery.volatile && <p>{t("recovery.storageVolatile")}</p>}
        {recoveryLoading && <StatusMessage>{t("recovery.loadingList")}</StatusMessage>}
        {recoveryError && <div><StatusMessage tone="danger">{t("recovery.listUnavailable")}</StatusMessage>
          <button type="button" onClick={retryRecoveryList}>{t("recovery.retryList")}</button></div>}
        <button type="button" disabled={!recoveryReady} onClick={acknowledgeRecovery}>{t("recovery.acknowledge")}</button>
      </section>}
      {recoveryAcknowledged && <StatusMessage tone="info">{t("recovery.acknowledged")}</StatusMessage>}
      {cashLocked && <p className="muted">{ta("page.cashTaskLock")}</p>}
      <div ref={expenseCapture.feedbackRef} tabIndex={-1} className="activity-feedback">
        {expenseCapture.feedback && <StatusMessage tone={expenseCapture.feedback.tone}>{expenseFeedbackMessage(expenseCapture.feedback, ta)}</StatusMessage>}
      </div>
      <div id="add-expense-task" hidden={!expenseCapture.open}>
        <ExpenseForm loading={cashLocked || expensesLoading || Boolean(expensesError) || expenseCapture.recoveryRequired}
          pending={expenseCapture.pending} onAdd={expenseCapture.submitCreate} onCancel={expenseCapture.closeCreate} inputRef={expenseCapture.inputRef}
          newName={expenseCapture.draft.description} setNewName={(value) => expenseCapture.updateDraft("description", value)}
          newAmount={expenseCapture.draft.amount} setNewAmount={(value) => expenseCapture.updateDraft("amount", value)}
          newDate={expenseCapture.draft.date} setNewDate={(value) => expenseCapture.updateDraft("date", value)}
          newCategory={expenseCapture.draft.category} setNewCategory={(value) => expenseCapture.updateDraft("category", value)}
          customCategory={expenseCapture.draft.customCategory} setCustomCategory={(value) => expenseCapture.updateDraft("customCategory", value)} />
      </div>
      <div id="statement-import-task" ref={importRegion} tabIndex={-1} hidden={!showImport} className="activity-import-task">
        <ImportPreviewPanel importState={importState} onImportConfirmed={refreshImportedActivity}
          externalLocked={cashLocked || Boolean(captureRecovery.source)}
          isExternallyLocked={() => cashLock.current || Boolean(captureRecovery.source)} />
        {!importMustStayVisible && <button type="button" className="button-ghost" onClick={() => {
          setImportOpen(false); focusAfterRender(() => importButton.current);
        }}>{ta("page.closeImport")}</button>}
      </div>
      {timelineEnabled && <ActivityTimeline timeline={timeline} filters={timelineFilters} uncertain={timelineUncertain} rowActions={timelineRowActions} />}
      <section className="activity-spending" aria-labelledby="spending-activity-heading">
        <div className="activity-spending__header">
          <h2 id="spending-activity-heading" ref={activityHeading} tabIndex={-1}>{ta("spending.heading")}</h2>
          <button type="button" className="button-ghost" disabled={expensesLoading || expenseCapture.pending}
            onClick={expenseCapture.refreshRecovery}>{ta("spending.refresh")}</button>
        </div>
        {!recoveringExpenses && <ExpenseFilters searchTerm={searchTerm} setSearchTerm={setSearchTerm} dateFilter={dateFilter} setDateFilter={setDateFilter}
          customStartDate={customStartDate} setCustomStartDate={setCustomStartDate} customEndDate={customEndDate} setCustomEndDate={setCustomEndDate}
          categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />}
        {expensesLoading && <StatusMessage>{expenses.length ? ta("spending.refreshing") : ta("spending.loading")}</StatusMessage>}
        {expensesError && <div>
          <StatusMessage tone="danger">{ta("spending.loadError")}</StatusMessage>
          <button type="button" disabled={expensesLoading || expenseCapture.pending} onClick={expenseCapture.refreshRecovery}>{ta("spending.retry")}</button>
        </div>}
        {editIsPinned && <StatusMessage>{ta("spending.pinnedEdit")}</StatusMessage>}
        {((!expensesLoading && !expensesError) || expensesToShow.length > 0) && <ExpenseList
          expenses={expensesToShow} totalCount={expenses.length} filteredCount={recoveringExpenses ? expenses.length : filteredExpenses.length}
          entriesPerPage={ENTRIES_PER_PAGE} showAll={recoveringExpenses || showAll} onShowAll={() => setShowAll(true)}
          editingExpenseId={editingExpense?.id ?? null} editingExpenseData={editingExpenseData} setEditingExpenseData={setEditingExpenseData}
          onStartEdit={startEditExpense} onSave={saveExpenseEdit} onCancel={cancelEditExpense} onDelete={handleDeleteExpense}
          busy={expenseCapture.pending} taskLocked={Boolean(captureRecovery.source) || cashLocked || Boolean(editingExpense)}
          readUnavailable={Boolean(captureRecovery.source) || expensesLoading || Boolean(expensesError) || expenseCapture.recoveryRequired} />}
      </section>
      <section className="activity-cash-in" aria-labelledby="cash-in-heading">
        <div className="activity-spending__header">
          <h2 id="cash-in-heading" ref={inflowCapture.fallbackFocusRef} tabIndex={-1}>{ta("cashIn.heading")}</h2>
          <button type="button" className="button-ghost" disabled={cash.loading || inflowCapture.pending} onClick={inflowCapture.refreshRecovery}>{ta("cashIn.refresh")}</button>
        </div>
        <p className="muted">{ta("cashIn.intro")}</p>
        <div ref={inflowCapture.feedbackRef} tabIndex={-1} className="activity-feedback">
          {inflowCapture.feedback && <StatusMessage tone={inflowCapture.feedback.tone}>{inflowFeedbackMessage(inflowCapture.feedback, ta)}</StatusMessage>}
          {inflowCapture.feedback?.saved && <a href="/analytics">{ta("cashIn.viewInsights")}</a>}
        </div>
        {inflowCapture.gate === "unknown" && <button type="button" className="button-ghost"
          disabled={!inflowCapture.checkedRead || cashReadUnavailable || inflowCapture.pending}
          onClick={inflowCapture.acknowledgeUnknown}>{ta("cashIn.checked")}</button>}
        <div id="cash-in-task" ref={inflowCapture.taskRef} hidden={!inflowCapture.task}>
          {inflowCapture.task && inflowCapture.task.type !== "delete" && <InflowForm mode={inflowCapture.task.type} draft={inflowCapture.task.draft}
            onChange={inflowCapture.updateDraft}
            fieldErrors={inflowFieldErrors} onSubmit={inflowCapture.submitTask} onCancel={inflowCapture.cancelTask} pending={inflowCapture.pending}
            disabled={cashReadUnavailable || Boolean(inflowCapture.gate) || legacyBlocked || inflowCapture.targetMissing}
            amountNeedsReview={inflowCapture.task.type === "edit" && isUnsafeAmount(inflowCapture.task.record.amount)} />}
          {inflowCapture.task?.type === "delete" && <div className="inflow-delete-confirmation" role="group" aria-labelledby="cash-in-delete-heading">
            <h3 id="cash-in-delete-heading">{ta("cashIn.delete.heading", {
              description: inflowCapture.task.record.description,
              date: formatInflowDate(inflowCapture.task.record.date, ta("cashIn.list.unknownDate")),
            })}</h3>
            <p>{ta("cashIn.delete.body")}</p>
            <p>{ta("cashIn.delete.imported")}</p>
            <div className="inline-actions">
              <button type="button" ref={inflowCapture.deleteButtonRef} className="button-danger"
                disabled={inflowCapture.pending || cashReadUnavailable || Boolean(inflowCapture.gate) || legacyBlocked || inflowCapture.targetMissing}
                onClick={inflowCapture.deleteTask}>{inflowCapture.pending ? ta("cashIn.delete.deleting") : ta("cashIn.delete.confirm")}</button>
              <button type="button" className="button-ghost" disabled={inflowCapture.pending} onClick={inflowCapture.cancelTask}>{ta("cashIn.delete.cancel")}</button>
            </div>
          </div>}
          {inflowCapture.targetMissing && <StatusMessage>{ta("cashIn.targetMissing")}</StatusMessage>}
        </div>
        {!recoveringCashIn && <label className="field">{ta("cashIn.search")}<input type="search" value={cashSearch} onChange={(event) => setCashSearch(event.target.value)} /></label>}
        {cash.loading && <StatusMessage>{cash.inflows.length ? ta("cashIn.refreshing") : ta("cashIn.loading")}</StatusMessage>}
        {cash.error && <StatusMessage tone="danger">{ta("cashIn.loadError")}</StatusMessage>}
        {cashPinned && <StatusMessage>{ta("cashIn.pinned")}</StatusMessage>}
        {(!cashReadUnavailable || cashRows.length > 0) && <InflowList inflows={cashRows} totalCount={cash.inflows.length}
          filteredCount={filteredCash.length} showAll={recoveringCashIn || cashShowAll} onShowAll={() => setCashShowAll(true)}
          onEdit={(record, opener) => openCashTask("edit", record, opener)} onDelete={(record, opener) => openCashTask("delete", record, opener)}
          disabled={cashLocked || legacyBlocked} readUnavailable={cashReadUnavailable} taskRecordId={inflowCapture.task?.record?.id ?? null} />}
      </section>
    </div>
  );
}
