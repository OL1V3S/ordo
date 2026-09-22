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
import StatusMessage from "../../../shared/ui/StatusMessage";
import "../../../styles/activity.css";
import "../../../styles/inflows.css";

const ENTRIES_PER_PAGE = 10;
function focusAfterRender(target) {
  window.requestAnimationFrame(() => target()?.focus());
}

const INFLOW_FIELD_MESSAGES = {
  description_invalid: "Enter a description of 1 to 500 characters.",
  amount_invalid: "Enter a positive amount with at most two decimals, up to 9999999999999999.99.",
  date_invalid: "Enter a valid calendar date.",
};

function expenseFeedbackMessage(feedback) {
  if (!feedback) return "";
  if (feedback.outcome === "unknown") return "We couldn’t confirm the change. Refresh activity and check the records before trying again.";
  if (feedback.outcome === "refreshed") return "Activity refreshed. Check the records before retrying your change.";
  const completed = { create: "Expense saved.", update: "Expense updated.", delete: "Expense deleted." }[feedback.kind];
  return feedback.refreshFailed
    ? `${completed} Activity could not be refreshed. Refresh the list before making another change.`
    : completed;
}

function inflowFeedbackMessage(feedback) {
  if (!feedback) return "";
  if (feedback.outcome === "completed") {
    const completed = {
      create: "Cash in saved. Reports use this entry’s posted date.",
      edit: "Cash in updated. Reports use this entry’s posted date.",
      delete: "Cash in deleted. Recorded reports will reflect its removal.",
    }[feedback.kind];
    return feedback.refreshFailed
      ? `${completed} The cash-in list could not be refreshed. Refresh cash in before another change.`
      : completed;
  }
  return {
    validation: "Cash in was not saved. Check the details and try again.",
    unauthorized: "Your session ended. Sign in again.",
    forbidden: "You do not have permission to change this cash-in record.",
    missing: "This cash-in record is unavailable. Refresh cash in before making another change.",
    unknown: "We couldn’t confirm the change. Refresh cash in and check the records before trying again.",
    unknown_checked: "Cash in refreshed. Check whether the change was saved before allowing another attempt.",
    refreshed: "Cash in refreshed. Check the current records before making another change.",
    retry_available: "You checked the records. Another attempt is now available; it will not run automatically.",
    blocked: "Finish or close the open expense or import task before changing cash in.",
  }[feedback.outcome];
}

export default function TransactionsPage() {
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
  const expenseCapture = useExpenseCapture({
    createExpense: addExpense,
    refresh: refreshExpenses,
    readUnavailable: expensesLoading || Boolean(expensesError),
    isExternallyBlocked: () => cashLock.current,
  });
  const inflowCapture = useInflowCapture({
    records: cash.inflows,
    loading: cash.loading,
    error: cash.error,
    refresh: cash.refresh,
    createInflow: cash.createInflow,
    updateInflow: cash.updateInflow,
    deleteInflow: cash.deleteInflow,
    isExternallyBlocked: () => legacyLock.current,
  });

  const filters = useMemo(() => ({
    dateFilter, customStartDate, customEndDate, categoryFilter, searchTerm,
  }), [dateFilter, customStartDate, customEndDate, categoryFilter, searchTerm]);
  const filteredExpenses = useMemo(() => filterExpenses(expenses, filters), [expenses, filters]);
  useEffect(() => { setShowAll(false); }, [filters]);
  const visibleExpenses = showAll ? filteredExpenses : filteredExpenses.slice(0, ENTRIES_PER_PAGE);
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
  const legacyBlocked = Boolean(expenseCapture.open || editingExpense || expenseCapture.pending || expenseCapture.recoveryRequired
    || (importOpen && !importState.confirmation) || importState.preview || importState.processing
    || importState.confirming || importState.loading || importState.error || importState.confirmationIssue);
  legacyLock.current = legacyBlocked;
  const cashReadUnavailable = inflowCapture.readUnavailable;
  const filteredCash = cash.inflows.filter((record) => record.description.toLowerCase().includes(cashSearch.trim().toLowerCase()));
  const visibleCash = cashShowAll ? filteredCash : filteredCash.slice(0, ENTRIES_PER_PAGE);
  const cashPinned = inflowCapture.task?.record && !visibleCash.some((record) => record.id === inflowCapture.task.record.id);
  const cashRows = cashPinned ? [inflowCapture.task.record, ...visibleCash] : visibleCash;
  const inflowFieldErrors = Object.fromEntries(Object.entries(inflowCapture.fieldErrors)
    .map(([field, code]) => [field, INFLOW_FIELD_MESSAGES[code] ?? code]));
  useEffect(() => { setCashShowAll(false); }, [cashSearch]);

  function openCashTask(type, record, opener) {
    if (cashLock.current || inflowCapture.isWriteInFlight()) { inflowCapture.focusTask(); return; }
    if (legacyLock.current) {
      inflowCapture.setBlockedFeedback?.();
      focusAfterRender(() => expenseCapture.open ? expenseCapture.inputRef.current : editingExpense
        ? document.querySelector('[aria-label="Edit description"]') : importRegion.current);
      return;
    }
    if (cashReadUnavailable) return;
    cashLock.current = true;
    inflowCapture.openTask(type, record, opener);
  }
  async function refreshImportedActivity(result) {
    const requests = [];
    if (result.importedExpenseCount > 0) requests.push({ name: "expenses", request: refreshExpenses() });
    if (result.importedInflowCount > 0) requests.push({ name: "cash in", request: cash.refresh() });
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
    legacyLock.current = true;
    const currentCategory = expense.category || "";
    const categoryIsDefault = isDefaultCategory(currentCategory, DEFAULT_CATEGORIES);
    editButton.current = opener;
    setEditingExpense(expense);
    setEditingExpenseData({
      description: expense.description || "",
      amount: Number(expense.amount ?? 0).toFixed(2),
      date: expense.date || "",
      category: categoryIsDefault ? normalizeText(currentCategory) : "other",
      customCategory: categoryIsDefault ? "" : currentCategory,
    });
  }
  function cancelEditExpense() {
    setEditingExpense(null);
    setEditingExpenseData({});
    focusAfterRender(() => editButton.current?.isConnected ? editButton.current : activityHeading.current);
  }
  async function saveExpenseEdit(id) {
    const finalCategory = editingExpenseData.category === "other"
      ? normalizeText(editingExpenseData.customCategory || "uncategorized")
      : normalizeText(editingExpenseData.category);
    await expenseCapture.runMutation(() => updateExpense(id, {
      id, description: normalizeText(editingExpenseData.description),
      amount: Math.round(parseFloat(editingExpenseData.amount) * 100) / 100,
      date: editingExpenseData.date, category: finalCategory,
    }), "update", cancelEditExpense);
  }
  async function handleDeleteExpense(id) {
    if (cashLock.current || expenseCapture.isWriteInFlight() || !window.confirm("Delete this expense?")) return;
    await expenseCapture.runMutation(() => deleteExpense(id), "delete");
  }

  return (
    <div className="container activity-page">
      <header className="page-header">
        <div><h1>Activity</h1><p className="muted">Review recorded spending and incoming money.</p></div>
        <div className="inline-actions activity-task-openers">
          <button type="button" ref={addButton} aria-expanded={expenseCapture.open} aria-controls="add-expense-task" onClick={openAdd}>
            Add expense
          </button>
          <button type="button" ref={cashAddButton} aria-expanded={inflowCapture.task?.type === "create"} aria-controls="cash-in-task"
            disabled={cashReadUnavailable || inflowCapture.pending || Boolean(inflowCapture.gate)}
            onClick={(event) => openCashTask("create", null, event.currentTarget)}>Add cash in</button>
          <button type="button" className="button-ghost" ref={importButton} aria-expanded={showImport} aria-controls="statement-import-task"
            onClick={() => { if (cashLock.current) { inflowCapture.focusTask(); return; } legacyLock.current = true; setImportOpen(true); focusAfterRender(() => importRegion.current); }}>
            Import statement
          </button>
        </div>
      </header>
      <nav className="activity-section-links" aria-label="Activity sections">
        <a href="#spending-activity-heading">Spending</a><a href="#cash-in-heading">Cash in</a>
      </nav>
      {cashLocked && <p className="muted">Finish the cash-in task or its refresh check before starting an expense or import task.</p>}
      <div ref={expenseCapture.feedbackRef} tabIndex={-1} className="activity-feedback">
        {expenseCapture.feedback && <StatusMessage tone={expenseCapture.feedback.tone}>{expenseFeedbackMessage(expenseCapture.feedback)}</StatusMessage>}
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
          externalLocked={cashLocked} isExternallyLocked={() => cashLock.current} />
        {!importMustStayVisible && <button type="button" className="button-ghost" onClick={() => {
          setImportOpen(false); focusAfterRender(() => importButton.current);
        }}>Close import</button>}
      </div>
      <section className="activity-spending" aria-labelledby="spending-activity-heading">
        <div className="activity-spending__header">
          <h2 id="spending-activity-heading" ref={activityHeading} tabIndex={-1}>Spending activity</h2>
          <button type="button" className="button-ghost" disabled={expensesLoading || expenseCapture.pending}
            onClick={expenseCapture.refreshRecovery}>Refresh activity</button>
        </div>
        <ExpenseFilters searchTerm={searchTerm} setSearchTerm={setSearchTerm} dateFilter={dateFilter} setDateFilter={setDateFilter}
          customStartDate={customStartDate} setCustomStartDate={setCustomStartDate} customEndDate={customEndDate} setCustomEndDate={setCustomEndDate}
          categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />
        {expensesLoading && <StatusMessage>{expenses.length ? "Refreshing expenses…" : "Loading expenses..."}</StatusMessage>}
        {expensesError && <div>
          <StatusMessage tone="danger">We couldn’t load your expenses.</StatusMessage>
          <button type="button" disabled={expensesLoading || expenseCapture.pending} onClick={expenseCapture.refreshRecovery}>Try again</button>
        </div>}
        {editIsPinned && <StatusMessage>Your open edit stays here while the list changes.</StatusMessage>}
        {((!expensesLoading && !expensesError) || expensesToShow.length > 0) && <ExpenseList
          expenses={expensesToShow} totalCount={expenses.length} filteredCount={filteredExpenses.length}
          entriesPerPage={ENTRIES_PER_PAGE} showAll={showAll} onShowAll={() => setShowAll(true)}
          editingExpenseId={editingExpense?.id ?? null} editingExpenseData={editingExpenseData} setEditingExpenseData={setEditingExpenseData}
          onStartEdit={startEditExpense} onSave={saveExpenseEdit} onCancel={cancelEditExpense} onDelete={handleDeleteExpense}
          busy={expenseCapture.pending} taskLocked={cashLocked || Boolean(editingExpense)} readUnavailable={expensesLoading || Boolean(expensesError) || expenseCapture.recoveryRequired} />}
      </section>
      <section className="activity-cash-in" aria-labelledby="cash-in-heading">
        <div className="activity-spending__header">
          <h2 id="cash-in-heading" ref={inflowCapture.fallbackFocusRef} tabIndex={-1}>Cash in</h2>
          <button type="button" className="button-ghost" disabled={cash.loading || inflowCapture.pending} onClick={inflowCapture.refreshRecovery}>Refresh cash in</button>
        </div>
        <p className="muted">Recorded incoming money, including transfers and refunds. A cash-in record is not automatically income or a paycheck.</p>
        <div ref={inflowCapture.feedbackRef} tabIndex={-1} className="activity-feedback">
          {inflowCapture.feedback && <StatusMessage tone={inflowCapture.feedback.tone}>{inflowFeedbackMessage(inflowCapture.feedback)}</StatusMessage>}
          {inflowCapture.feedback?.saved && <a href="/analytics">View Insights</a>}
        </div>
        {inflowCapture.gate === "unknown" && <button type="button" className="button-ghost"
          disabled={!inflowCapture.checkedRead || cashReadUnavailable || inflowCapture.pending}
          onClick={inflowCapture.acknowledgeUnknown}>I checked cash in</button>}
        <div id="cash-in-task" ref={inflowCapture.taskRef} hidden={!inflowCapture.task}>
          {inflowCapture.task && inflowCapture.task.type !== "delete" && <InflowForm mode={inflowCapture.task.type} draft={inflowCapture.task.draft}
            onChange={inflowCapture.updateDraft}
            fieldErrors={inflowFieldErrors} onSubmit={inflowCapture.submitTask} onCancel={inflowCapture.cancelTask} pending={inflowCapture.pending}
            disabled={cashReadUnavailable || Boolean(inflowCapture.gate) || legacyBlocked || inflowCapture.targetMissing}
            amountNeedsReview={inflowCapture.task.type === "edit" && isUnsafeAmount(inflowCapture.task.record.amount)} />}
          {inflowCapture.task?.type === "delete" && <div className="inflow-delete-confirmation" role="group" aria-labelledby="cash-in-delete-heading">
            <h3 id="cash-in-delete-heading">Delete cash in: {inflowCapture.task.record.description} ({formatInflowDate(inflowCapture.task.record.date)})?</h3>
            <p>This removes the record from cash-flow history. Any supporting paycheck link is removed; the saved paycheck expectation remains.</p>
            <p>If this entry was imported, importing the same confirmed statement again will not restore it.</p>
            <div className="inline-actions">
              <button type="button" ref={inflowCapture.deleteButtonRef} className="button-danger"
                disabled={inflowCapture.pending || cashReadUnavailable || Boolean(inflowCapture.gate) || legacyBlocked || inflowCapture.targetMissing}
                onClick={inflowCapture.deleteTask}>{inflowCapture.pending ? "Deleting…" : "Confirm delete cash in"}</button>
              <button type="button" className="button-ghost" disabled={inflowCapture.pending} onClick={inflowCapture.cancelTask}>Cancel</button>
            </div>
          </div>}
          {inflowCapture.targetMissing && <StatusMessage>This entry is no longer in the current list. Cancel this task to choose another record.</StatusMessage>}
        </div>
        <label className="field">Search cash in<input type="search" value={cashSearch} onChange={(event) => setCashSearch(event.target.value)} /></label>
        {cash.loading && <StatusMessage>{cash.inflows.length ? "Refreshing cash in…" : "Loading cash in…"}</StatusMessage>}
        {cash.error && <StatusMessage tone="danger">We couldn’t load cash in. Refresh cash in to try again.</StatusMessage>}
        {cashPinned && <StatusMessage>Your open cash-in record stays visible while the list changes.</StatusMessage>}
        {(!cashReadUnavailable || cashRows.length > 0) && <InflowList inflows={cashRows} totalCount={cash.inflows.length}
          filteredCount={filteredCash.length} showAll={cashShowAll} onShowAll={() => setCashShowAll(true)}
          onEdit={(record, opener) => openCashTask("edit", record, opener)} onDelete={(record, opener) => openCashTask("delete", record, opener)}
          disabled={cashLocked || legacyBlocked} readUnavailable={cashReadUnavailable} taskRecordId={inflowCapture.task?.record?.id ?? null} />}
      </section>
    </div>
  );
}
