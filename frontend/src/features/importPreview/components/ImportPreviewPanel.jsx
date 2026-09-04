import { useEffect, useRef, useState } from "react";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import Card from "../../../shared/ui/Card";
import { isDefaultCategory, normalizeText } from "../../../utils/text";
import ImportPreviewRow from "./ImportPreviewRow";

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

function formatConfirmationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "an unavailable time" : date.toLocaleString();
}

function issueTitle(code) {
  if (code === "duplicate_review_required") return "Review new duplicate warnings";
  if (code === "preview_expired") return "Preview expired";
  if (code === "preview_unavailable") return "Preview unavailable";
  return "Statement was not confirmed";
}

function focusAfterRender(ref) {
  const focus = () => ref.current?.focus();
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focus);
  else window.setTimeout(focus, 0);
}

export default function ImportPreviewPanel({ importState, onImportConfirmed = async () => {} }) {
  const {
    preview,
    sourceType,
    loading,
    processing,
    error,
    confirming,
    confirmation,
    confirmationIssue,
    selectedCount,
    selectSource,
    upload,
    cancel,
    updateRow,
    confirm,
    clearForReupload,
  } = importState;
  const [dragging, setDragging] = useState(false);
  const [rowDrafts, setRowDrafts] = useState({ batchId: null, rows: {} });
  const [refreshError, setRefreshError] = useState("");
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
    if (!confirmation) setRefreshError("");
  }, [confirmation]);

  async function submitFile(file) {
    if (!file || !sourceType) return;
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
    if (confirming || confirmationIssue?.requiresPreviewRefresh || rowUpdatesInFlight.current.has(row.rowId)) return null;
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
  const confirmDisabled = selectedCount === 0
    || hasPendingRows
    || hasDirtyRows
    || confirming
    || confirmationNeedsRefresh;

  async function handleConfirm() {
    if (confirmDisabled || rowUpdatesInFlight.current.size > 0) return;
    setRefreshError("");
    const result = await confirm();
    if (!result) {
      focusAfterRender(issueHeading);
      return;
    }

    focusAfterRender(completionHeading);
    try {
      if (result.importedExpenseCount > 0) await onImportConfirmed();
    } catch {
      setRefreshError("The import succeeded, but Transactions could not be refreshed. Reload this page to see imported expenses.");
    }
  }

  function confirmationGuidance() {
    if (confirmationNeedsRefresh) return "Refresh this page to load the authoritative duplicate review before confirming.";
    if (hasPendingRows) return "Wait for every row update to finish before confirming.";
    if (hasDirtyRows) return "Save every row with unsaved changes before confirming.";
    if (selectedCount === 0) return "Select at least one eligible row to import.";
    return `${selectedCount} selected ${selectedCount === 1 ? "row is" : "rows are"} ready to confirm.`;
  }

  function confirmationCodesFor(rowId) {
    return confirmationIssue?.rows.find((row) => row.rowId === rowId)?.codes ?? [];
  }

  function renderRow(row, presentation) {
    return (
      <ImportPreviewRow
        key={row.rowId}
        row={row}
        draft={draftFor(row)}
        confirmationCodes={confirmationCodesFor(row.rowId)}
        disabled={confirming || confirmationNeedsRefresh}
        presentation={presentation}
        onDraftChange={(changes) => changeDraft(row, changes)}
        onSave={() => saveRow(row)}
        onSelectionChange={(selected) => updateSelection(row, selected)}
      />
    );
  }

  return (
    <Card as="section" className="section import-preview" aria-labelledby="import-preview-title">
      <div className="section__header import-preview__header">
        <div>
          <p className="page-header__eyebrow">
            {confirmation ? "Import complete" : preview ? "Review and confirm" : "Bank statement import"}
          </p>
          <h2 className="h2" id="import-preview-title">Import bank statement</h2>
          <p className="muted">Choose the bank, then upload a text-extractable PDF up to 10 MiB. Scanned statements are not supported.</p>
        </div>
        {preview && (
          <button
            type="button"
            className="button-ghost"
            disabled={confirming || hasPendingRows}
            onClick={clearForReupload}
          >
            Choose another statement
          </button>
        )}
      </div>

      {!confirmation && (
        <div className="status-message status-message--info">
          Review and save any edits before confirming. Expenses and explicitly selected incoming deposits are created only after confirmation.
        </div>
      )}

      {confirmation && (
        <div className="status-message status-message--success import-completion" role="status" aria-live="polite">
          <h3 className="h3" ref={completionHeading} tabIndex="-1">
            {confirmation.status === "already_confirmed" ? "Statement already imported" : "Import complete"}
          </h3>
          <p>
            {confirmation.importedExpenseCount} {confirmation.importedExpenseCount === 1 ? "expense" : "expenses"}
            {" and "}
            {confirmation.importedInflowCount} {confirmation.importedInflowCount === 1 ? "incoming deposit" : "incoming deposits"}
            {confirmation.status === "already_confirmed" ? " were already saved" : " saved"}
            {` at ${formatConfirmationTime(confirmation.confirmedAt)}.`}
          </p>
        </div>
      )}

      {refreshError && <div className="status-message status-message--danger" role="alert">{refreshError}</div>}

      <div className="import-source-control">
        <label htmlFor="statement-source">Bank</label>
        <select
          id="statement-source"
          required
          value={sourceType}
          disabled={processing || confirming || Boolean(preview)}
          onChange={(event) => {
            setRefreshError("");
            selectSource(event.target.value);
          }}
        >
          <option value="">Choose a bank</option>
          <option value="sunflower_pdf">Sunflower Bank</option>
        </select>
        {!sourceType && <p className="muted">Choose a bank to enable PDF upload.</p>}
      </div>

      {error && <div className="status-message status-message--danger" role="alert">{error}</div>}
      {confirmationIssue && (
        <div className="status-message status-message--danger" role="alert">
          <h3 className="h3" ref={issueHeading} tabIndex="-1">{issueTitle(confirmationIssue.code)}</h3>
          <p>{confirmationIssue.message}</p>
        </div>
      )}
      {(loading || processing) && (
        <div className="import-processing" role="status" aria-live="polite">
          <span>{loading ? "Looking for an unfinished preview…" : "Processing the statement safely…"}</span>
          {processing && <button type="button" className="button-ghost" onClick={cancel}>Cancel</button>}
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
          <label className="sr-only" htmlFor="sunflower-statement-file">Sunflower statement PDF</label>
          <input
            className="sr-only"
            ref={fileInput}
            id="sunflower-statement-file"
            type="file"
            accept=".pdf,application/pdf"
            disabled={!sourceType}
            onChange={(event) => submitFile(event.target.files?.[0])}
          />
          <p><strong>Drop a statement PDF here</strong> or choose it from your device.</p>
          <button type="button" disabled={!sourceType} onClick={() => fileInput.current?.click()}>Choose PDF</button>
        </div>
      )}

      {preview && (
        <div className="import-results">
          <div className="import-results__summary">
            <div>
              <h3 className="h3" ref={resultsHeading} tabIndex="-1">Statement preview</h3>
              <p className="muted">{preview.rows.length} rows · available until {new Date(preview.expiresAt).toLocaleString()}</p>
            </div>
            <div className="import-confirmation-actions">
              <p id="import-confirmation-guidance" className="muted" role="status" aria-live="polite">
                {confirmationGuidance()}
              </p>
              <button
                type="button"
                disabled={confirmDisabled}
                aria-busy={confirming}
                aria-describedby="import-confirmation-guidance"
                onClick={handleConfirm}
              >
                {confirming
                  ? "Confirming selected rows…"
                  : selectedCount > 0
                    ? `Confirm ${selectedCount} selected ${selectedCount === 1 ? "row" : "rows"}`
                    : "Confirm selected rows"}
              </button>
            </div>
          </div>
          <div className="table-wrapper import-preview-table" role="region" aria-label="Statement import preview" tabIndex="0">
            <table className="data-table">
              <caption>Sunflower Bank statement rows</caption>
              <thead><tr><th>Row</th><th>Statement details</th><th>Status</th><th>Selection</th><th>Expense fields</th></tr></thead>
              <tbody>{preview.rows.map((row) => renderRow(row, "table"))}</tbody>
            </table>
          </div>
          <div className="import-preview-cards">
            {preview.rows.map((row) => renderRow(row, "card"))}
          </div>
        </div>
      )}
    </Card>
  );
}
