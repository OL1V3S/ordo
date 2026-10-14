import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { formatDateTime } from "../../../shared/localization/format";
import { useLocale } from "../../../shared/localization/useLocale";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import Card from "../../../shared/ui/Card";
import { isDefaultCategory, normalizeText } from "../../../utils/text";
import {
  bulkClearTargets,
  bulkSelectableExpenses,
  filterCounts,
  rowMatchesFilter,
  selectedTotals,
  summarize,
} from "../utils/importReview";
import ImportConfirmBar from "./ImportConfirmBar";
import ImportPreviewRow from "./ImportPreviewRow";
import ImportResults from "./ImportResults";
import ImportReviewFilters from "./ImportReviewFilters";
import ImportReviewSummary from "./ImportReviewSummary";

function createRowDraft(row, outcome = "idle") {
  const category = row.category ?? "uncategorized";
  const defaultCategory = isDefaultCategory(category, DEFAULT_CATEGORIES) || category === "uncategorized";
  return {
    description: row.editableExpenseDescription ?? "",
    categoryChoice: defaultCategory ? normalizeText(category) : "other",
    customCategory: defaultCategory ? "" : category,
    dirty: false,
    pending: false,
    outcome,
  };
}

function categoryFromDraft(draft) {
  return draft.categoryChoice === "other"
    ? normalizeText(draft.customCategory)
    : draft.categoryChoice;
}

function isDraftDirty(draft, row) {
  return draft.description.trim() !== (row.editableExpenseDescription ?? "")
    || categoryFromDraft(draft) !== (row.category ?? "");
}

function parseConfirmationTime(value, locale) {
  return formatDateTime(value, locale);
}

function formatSelectionCounts(t, expenseCount, inflowCount) {
  return t("selection.summary", {
    expenses: t("selection.expenses", { count: expenseCount }),
    deposits: t("selection.deposits", { count: inflowCount }),
  });
}

function issueTitle(t, code) {
  const known = ["duplicate_review_required", "preview_expired", "preview_unavailable"];
  return t(`panel.issueTitle.${known.includes(code) ? code : "default"}`);
}

function completionMessage(t, confirmation, locale) {
  const summary = formatSelectionCounts(t, confirmation.importedExpenseCount, confirmation.importedInflowCount);
  const time = parseConfirmationTime(confirmation.confirmedAt, locale);
  const prefix = confirmation.status === "already_confirmed" ? "alreadySaved" : "saved";
  return time === null
    ? t(`completion.${prefix}UnavailableTime`, { summary })
    : t(`completion.${prefix}`, { summary, time });
}

function focusAfterRender(ref) {
  const focus = () => ref.current?.focus();
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus);
  else window.setTimeout(focus, 0);
}

export default function ImportPreviewPanel({ importState, onImportConfirmed = async () => {}, onViewActivity, onDone, externalLocked = false, isExternallyLocked = () => false }) {
  const { t } = useTranslation("importPreview");
  const { locale } = useLocale();
  const externallyBlocked = () => externalLocked || isExternallyLocked();
  const {
    preview,
    sourceType,
    loading,
    processing,
    error,
    confirming,
    confirmation,
    confirmedRows = null,
    confirmationIssue,
    selectedCount,
    selectSource,
    upload,
    cancel,
    updateRow,
    bulkSelection,
    confirm,
    clearForReupload,
    dismissConfirmation,
  } = importState;
  const [dragging, setDragging] = useState(false);
  const [rowDrafts, setRowDrafts] = useState({ batchId: null, rows: {} });
  const [refreshError, setRefreshError] = useState("");
  // Filter and pinned rows belong to one batch; a different batch derives back to "all".
  const [view, setView] = useState({ batchId: null, filter: "all", pinned: [] });
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkOutcome, setBulkOutcome] = useState(null);
  const bulkRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const latest = useRef(null);
  const rowUpdatesInFlight = useRef(new Set());
  const fileInput = useRef(null);
  const resultsHeading = useRef(null);
  const completionHeading = useRef(null);
  const issueHeading = useRef(null);

  useEffect(() => {
    setRowDrafts((current) => {
      if (!preview) return current.batchId === null ? current : { batchId: null, rows: {} };
      const sameBatch = current.batchId === preview.batchId;
      const rows = Object.fromEntries(preview.rows.map((row) => {
        const existing = sameBatch ? current.rows[row.rowId] : null;
        if (existing?.dirty || existing?.pending) return [row.rowId, existing];
        return [row.rowId, createRowDraft(row, existing?.outcome === "saved" ? "saved" : "idle")];
      }));
      return { batchId: preview.batchId, rows };
    });
  }, [preview]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!confirmation) setRefreshError("");
  }, [confirmation]);

  async function submitFile(file) {
    if (externallyBlocked() || !file || !sourceType) return;
    setRefreshError("");
    const result = await upload(file);
    if (result) focusAfterRender(resultsHeading);
  }

  function drop(event) {
    event.preventDefault();
    setDragging(false);
    if (!sourceType) return;
    submitFile(event.dataTransfer.files?.[0]);
  }

  function draftFor(row) {
    return rowDrafts.batchId === preview?.batchId && rowDrafts.rows[row.rowId]
      ? rowDrafts.rows[row.rowId]
      : createRowDraft(row);
  }

  function changeDraft(row, changes) {
    if (externallyBlocked()) return;
    setRowDrafts((current) => {
      const sameBatch = current.batchId === preview?.batchId;
      const existing = sameBatch && current.rows[row.rowId]
        ? current.rows[row.rowId]
        : createRowDraft(row);
      const updated = { ...existing, ...changes, outcome: "idle" };
      updated.dirty = isDraftDirty(updated, row);
      return {
        batchId: preview.batchId,
        rows: { ...(sameBatch ? current.rows : {}), [row.rowId]: updated },
      };
    });
  }

  function markRowPending(row) {
    setRowDrafts((current) => {
      const existing = current.batchId === preview?.batchId && current.rows[row.rowId]
        ? current.rows[row.rowId]
        : createRowDraft(row);
      return {
        batchId: preview.batchId,
        rows: {
          ...(current.batchId === preview?.batchId ? current.rows : {}),
          [row.rowId]: { ...existing, pending: true, outcome: "idle" },
        },
      };
    });
  }

  function finishRowUpdate(row, updatedRow, savedFields) {
    setRowDrafts((current) => {
      const existing = current.rows[row.rowId] ?? createRowDraft(row);
      if (!updatedRow) {
        return {
          ...current,
          rows: {
            ...current.rows,
            [row.rowId]: { ...existing, pending: false, outcome: "error" },
          },
        };
      }
      if (savedFields) {
        return {
          ...current,
          rows: {
            ...current.rows,
            [row.rowId]: createRowDraft(updatedRow, "saved"),
          },
        };
      }

      const next = { ...existing, pending: false };
      next.dirty = isDraftDirty(next, updatedRow);
      next.outcome = next.dirty ? "idle" : "saved";
      return {
        ...current,
        rows: { ...current.rows, [row.rowId]: next },
      };
    });
  }

  async function runRowUpdate(row, payload, savedFields) {
    if (externallyBlocked() || confirming || confirmationIssue?.requiresPreviewRefresh || rowUpdatesInFlight.current.has(row.rowId)) return null;
    rowUpdatesInFlight.current.add(row.rowId);
    markRowPending(row);
    try {
      const updatedRow = await updateRow(row.rowId, payload);
      finishRowUpdate(row, updatedRow, savedFields);
      return updatedRow;
    } catch {
      finishRowUpdate(row, null, savedFields);
      return null;
    } finally {
      rowUpdatesInFlight.current.delete(row.rowId);
    }
  }

  async function saveRow(row) {
    const draft = draftFor(row);
    if (!draft.dirty) return null;
    return runRowUpdate(row, {
      editableExpenseDescription: draft.description.trim(),
      category: categoryFromDraft(draft),
      selectedForImport: row.selectedForImport,
      selectedForInflow: false,
    }, true);
  }

  async function updateSelection(row, selected) {
    return runRowUpdate(row, {
      editableExpenseDescription: row.isEligible ? row.editableExpenseDescription : null,
      category: row.isEligible ? row.category : null,
      selectedForImport: row.isEligible ? selected : false,
      selectedForInflow: row.isInflowEligible ? selected : false,
    }, false);
  }

  const drafts = Object.values(rowDrafts.rows);
  const hasPendingRows = drafts.some((draft) => draft.pending);
  const hasDirtyRows = drafts.some((draft) => draft.dirty);
  const confirmationNeedsRefresh = Boolean(confirmationIssue?.requiresPreviewRefresh);
  const confirmDisabled = externalLocked || selectedCount === 0
    || hasPendingRows
    || hasDirtyRows
    || bulkRunning
    || confirming
    || confirmationNeedsRefresh;

  const currentBatchId = preview?.batchId ?? null;
  const filter = view.batchId === currentBatchId ? view.filter : "all";
  const pinned = view.batchId === currentBatchId ? view.pinned : [];

  function changeFilter(next) {
    setView({ batchId: currentBatchId, filter: next, pinned: [] });
  }

  function pinRows(rowIds) {
    setView((current) => {
      const batchId = latest.current?.preview?.batchId ?? null;
      const same = current.batchId === batchId;
      return {
        batchId,
        filter: same ? current.filter : "all",
        pinned: [...new Set([...(same ? current.pinned : []), ...rowIds])],
      };
    });
  }

  // The bulk action reads everything through this ref so it sees the latest preview, batch,
  // lock and confirm state, and uses the handler bound to that render.
  useLayoutEffect(() => {
    latest.current = {
      preview,
      confirming,
      confirmationNeedsRefresh,
      externallyBlocked,
      bulkSelection,
    };
  });

  // The server marks the changed rows; mirror the single-row "Saved" marker for them unless the
  // user has an unsaved edit on the row.
  function markRowsSaved(batchId, rowIds) {
    if (rowIds.length === 0) return;
    setRowDrafts((current) => {
      if (current.batchId !== batchId) return current;
      const rows = { ...current.rows };
      for (const rowId of rowIds) {
        const existing = rows[rowId];
        if (existing && !existing.dirty && !existing.pending) rows[rowId] = { ...existing, outcome: "saved" };
      }
      return { ...current, rows };
    });
  }

  // One request for the whole action. The server applies it atomically, so there is no partial
  // "stopped" state: the outcome is a count, a definite failure, or a locked-for-refresh issue.
  async function runBulk(kind) {
    const start = latest.current;
    if (bulkRunningRef.current || !start?.preview) return;
    if (start.externallyBlocked() || start.confirming || start.confirmationNeedsRefresh) return;
    // Bulk actions are inert while a single-row update is in flight.
    if (rowUpdatesInFlight.current.size > 0) return;
    const batchId = start.preview.batchId;
    const select = kind === "select";
    const targets = select ? bulkSelectableExpenses(start.preview.rows) : bulkClearTargets(start.preview.rows);
    if (targets.length === 0) return;
    const rowIds = targets.map((row) => row.rowId);
    const hiddenByFilter = kind === "clear" && filter === "selected";

    bulkRunningRef.current = true;
    setBulkRunning(true);
    setBulkOutcome(null);
    setBulkProgress({ kind, count: rowIds.length });
    if (!hiddenByFilter) pinRows(rowIds);
    try {
      const result = await start.bulkSelection(select ? "select_expenses" : "clear", rowIds);
      // A late response for a preview that was cancelled, replaced, or unmounted is ignored.
      if (!mountedRef.current || latest.current?.preview?.batchId !== batchId) return;
      if (result?.status === "done") {
        markRowsSaved(batchId, result.changedRowIds ?? []);
        setBulkOutcome({
          batchId,
          kind: select ? "selectedDone" : "clearedDone",
          count: result.count,
          hiddenByFilter,
        });
      } else if (result?.status === "failed") {
        setBulkOutcome({ batchId, kind: "failed" });
      }
      // "uncertain" and "unavailable" surface through the confirmation issue the hook sets.
    } finally {
      bulkRunningRef.current = false;
      if (mountedRef.current) {
        setBulkRunning(false);
        setBulkProgress(null);
      }
    }
  }

  function bulkMessage() {
    if (!bulkOutcome || bulkOutcome.batchId !== currentBatchId) return "";
    if (bulkOutcome.kind === "failed") return t("bulk.failed");
    const text = t(`bulk.${bulkOutcome.kind}`, { count: bulkOutcome.count });
    return bulkOutcome.hiddenByFilter ? `${text} ${t("filters.clearedHidden")}` : text;
  }

  async function handleConfirm() {
    if (externallyBlocked() || confirmDisabled || bulkRunningRef.current || rowUpdatesInFlight.current.size > 0) return;
    setRefreshError("");
    const result = await confirm();
    if (!result) {
      focusAfterRender(issueHeading);
      return;
    }

    focusAfterRender(completionHeading);
    try {
      if (result.importedExpenseCount > 0 || result.importedInflowCount > 0) {
        const refreshed = await onImportConfirmed(result);
        const failed = refreshed?.failedLists?.filter((name) => ["expenses", "cashIn"].includes(name)) ?? [];
        if (failed.length) setRefreshError(t(`completion.refreshFailed.${failed.length > 1 ? "both" : failed[0]}`));
      }
    } catch {
      setRefreshError(t("completion.refreshFailed.generic"));
    }
  }

  const rows = preview?.rows ?? [];
  const summary = summarize(rows);
  const selectedExpenseCount = summary.expensesSelected;
  const selectedInflowCount = summary.depositsSelected;
  const selectedItemsLabel = formatSelectionCounts(t, selectedExpenseCount, selectedInflowCount);

  function confirmationGuidance() {
    if (externalLocked) return t("results.guidance.externalLocked");
    if (confirmationNeedsRefresh) {
      return t(confirmationIssue?.code === "selection_uncertain"
        ? "results.guidance.selectionUncertain"
        : "results.guidance.needsRefresh");
    }
    if (bulkRunning) return t("results.guidance.bulk");
    if (hasPendingRows) return t("results.guidance.pending");
    if (hasDirtyRows) return t("results.guidance.dirty");
    if (selectedCount === 0) return t("results.guidance.noneSelected");
    return t("results.guidance.ready");
  }

  function confirmationCodesFor(rowId) {
    return confirmationIssue?.rows.find((row) => row.rowId === rowId)?.codes ?? [];
  }

  const pinnedIds = new Set(pinned);
  const visibleRows = rows.filter((row) => {
    if (filter === "all" || rowMatchesFilter(row, filter, confirmationCodesFor(row.rowId)) || pinnedIds.has(row.rowId)) return true;
    const draft = rowDrafts.batchId === currentBatchId ? rowDrafts.rows[row.rowId] : null;
    return Boolean(draft?.dirty || draft?.pending);
  });

  function renderRow(row) {
    return (
      <ImportPreviewRow
        key={row.rowId}
        row={row}
        draft={draftFor(row)}
        confirmationCodes={confirmationCodesFor(row.rowId)}
        disabled={externalLocked || confirming || confirmationNeedsRefresh || bulkRunning}
        onDraftChange={(changes) => changeDraft(row, changes)}
        onSave={() => { pinRows([row.rowId]); return saveRow(row); }}
        onSelectionChange={(selected) => { pinRows([row.rowId]); return updateSelection(row, selected); }}
      />
    );
  }

  return (
    <Card as="section" className="section import-preview">
      <div className="section__header import-preview__header">
        <div>
          <p className="page-header__eyebrow">
            {confirmation ? t("panel.eyebrow.complete") : preview ? t("panel.eyebrow.review") : t("panel.eyebrow.idle")}
          </p>
          <h2 className="h2" id="import-preview-title">{t("panel.title")}</h2>
          <p className="muted">{t("panel.intro")}</p>
        </div>
        {preview && (
          <button
            type="button"
            className="button-ghost"
            disabled={externalLocked || confirming || hasPendingRows || hasDirtyRows || bulkRunning}
            onClick={() => { if (!externallyBlocked()) clearForReupload(); }}
          >
            {t("panel.chooseAnother")}
          </button>
        )}
      </div>

      {!confirmation && (
        <div className="status-message status-message--info">
          {t("panel.notice")}
        </div>
      )}

      {confirmation && (
        <div className="status-message status-message--success import-completion" role="status" aria-live="polite">
          <h3 className="h3" ref={completionHeading} tabIndex="-1">
            {confirmation.status === "already_confirmed" ? t("completion.alreadyTitle") : t("completion.title")}
          </h3>
          <p>{completionMessage(t, confirmation, locale)}</p>
        </div>
      )}
      {confirmation && (
        <ImportResults
          confirmation={confirmation}
          savedRows={confirmedRows}
          onViewActivity={onViewActivity ? () => { dismissConfirmation?.(); onViewActivity(); } : undefined}
          onDone={() => { dismissConfirmation?.(); onDone?.(); }}
        />
      )}

      {refreshError && <div className="status-message status-message--danger" role="alert">{refreshError}</div>}

      <div className="import-source-control">
        <label htmlFor="statement-source">{t("source.label")}</label>
        <select
          id="statement-source"
          required
          value={sourceType}
          disabled={externalLocked || processing || confirming || Boolean(preview)}
          onChange={(event) => {
            if (externallyBlocked()) return;
            setRefreshError("");
            selectSource(event.target.value);
          }}
        >
          <option value="">{t("source.placeholder")}</option>
          <option value="sunflower_pdf">{t("source.sunflower")}</option>
        </select>
        {!sourceType && <p className="muted">{t("source.hint")}</p>}
      </div>

      {error && <div className="status-message status-message--danger" role="alert">{error}</div>}
      {confirmationIssue && (
        <div className="status-message status-message--danger" role="alert">
          <h3 className="h3" ref={issueHeading} tabIndex="-1">{issueTitle(t, confirmationIssue.code)}</h3>
          <p>{confirmationIssue.message}</p>
        </div>
      )}
      {(loading || processing) && (
        <div className="import-processing" role="status" aria-live="polite">
          <span>{loading ? t("panel.loadingPreview") : t("panel.processing")}</span>
          {processing && <button type="button" className="button-ghost" disabled={externalLocked} onClick={() => { if (!externallyBlocked()) cancel(); }}>{t("panel.cancel")}</button>}
        </div>
      )}

      {!loading && !preview && !processing && (
        <div
          className={`import-dropzone${dragging ? " import-dropzone--active" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <label className="sr-only" htmlFor="sunflower-statement-file">{t("dropzone.fileLabel")}</label>
          <input
            className="sr-only"
            ref={fileInput}
            id="sunflower-statement-file"
            type="file"
            accept=".pdf,application/pdf"
            disabled={externalLocked || !sourceType}
            onChange={(event) => submitFile(event.target.files?.[0])}
          />
          <p><Trans t={t} i18nKey="dropzone.prompt" components={{ strong: <strong /> }} /></p>
          <button type="button" disabled={externalLocked || !sourceType} onClick={() => { if (!externallyBlocked()) fileInput.current?.click(); }}>{t("dropzone.choosePdf")}</button>
        </div>
      )}

      {preview && (
        <div className="import-results">
          <div className="import-results__summary">
            <div>
              <h3 className="h3" ref={resultsHeading} tabIndex="-1">{t("results.heading")}</h3>
              <p className="muted">{t("results.meta", { count: preview.rows.length, expires: formatDateTime(preview.expiresAt, locale) ?? String(preview.expiresAt) })}</p>
            </div>
          </div>
          <ImportReviewSummary summary={summary} />
          <ImportReviewFilters
            filter={filter}
            counts={filterCounts(rows, confirmationCodesFor)}
            shown={visibleRows.length}
            total={rows.length}
            hardLocked={externalLocked || confirming || confirmationNeedsRefresh}
            bulkRunning={bulkRunning}
            rowSavePending={hasPendingRows}
            bulkProgress={bulkProgress}
            bulkMessage={bulkMessage()}
            selectableCount={bulkSelectableExpenses(rows).length}
            selectedCount={selectedCount}
            onFilterChange={changeFilter}
            onSelectAll={() => runBulk("select")}
            onClear={() => runBulk("clear")}
          />
          {visibleRows.length === 0 && <p className="muted">{t("filters.empty")}</p>}
          {visibleRows.length > 0 && (
            <div className="table-wrapper import-preview-table" role="region" aria-label={t("results.regionLabel")} tabIndex="0">
              <table className="data-table">
                <caption>{t("results.caption")}</caption>
                <thead><tr><th>{t("columns.transaction")}</th><th>{t("columns.status")}</th><th>{t("columns.selection")}</th><th>{t("columns.fields")}</th></tr></thead>
                <tbody>{visibleRows.map((row) => renderRow(row))}</tbody>
              </table>
            </div>
          )}
          <ImportConfirmBar
            selectedItemsLabel={selectedItemsLabel}
            totals={selectedTotals(rows)}
            guidance={confirmationGuidance()}
            disabled={confirmDisabled}
            confirming={confirming}
            confirmLabel={confirming
              ? t("results.saving", { items: selectedItemsLabel })
              : t("results.save", { items: selectedItemsLabel })}
            onConfirm={handleConfirm}
          />
        </div>
      )}
    </Card>
  );
}
