import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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

function parseConfirmationTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
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

function completionMessage(t, confirmation) {
  const summary = formatSelectionCounts(t, confirmation.importedExpenseCount, confirmation.importedInflowCount);
  const time = parseConfirmationTime(confirmation.confirmedAt);
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

export default function ImportPreviewPanel({ importState, onImportConfirmed = async () => {}, externalLocked = false, isExternallyLocked = () => false }) {
  const { t } = useTranslation("importPreview");
  const externallyBlocked = () => externalLocked || isExternallyLocked();
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
    || confirming
    || confirmationNeedsRefresh;

  async function handleConfirm() {
    if (externallyBlocked() || confirmDisabled || rowUpdatesInFlight.current.size > 0) return;
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

  const selectedExpenseCount = preview?.rows.filter((row) => row.isEligible && row.selectedForImport).length ?? 0;
  const selectedInflowCount = preview?.rows.filter((row) => row.isInflowEligible && row.selectedForInflow).length ?? 0;
  const selectedItemsLabel = formatSelectionCounts(t, selectedExpenseCount, selectedInflowCount);

  function confirmationGuidance() {
    if (externalLocked) return t("results.guidance.externalLocked");
    if (confirmationNeedsRefresh) return t("results.guidance.needsRefresh");
    if (hasPendingRows) return t("results.guidance.pending");
    if (hasDirtyRows) return t("results.guidance.dirty");
    if (selectedCount === 0) return t("results.guidance.noneSelected");
    return t("results.guidance.ready");
  }

  function confirmationCodesFor(rowId) {
    return confirmationIssue?.rows.find((row) => row.rowId === rowId)?.codes ?? [];
  }

  function renderRow(row) {
    return (
      <ImportPreviewRow
        key={row.rowId}
        row={row}
        draft={draftFor(row)}
        confirmationCodes={confirmationCodesFor(row.rowId)}
        disabled={externalLocked || confirming || confirmationNeedsRefresh}
        onDraftChange={(changes) => changeDraft(row, changes)}
        onSave={() => saveRow(row)}
        onSelectionChange={(selected) => updateSelection(row, selected)}
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
            disabled={externalLocked || confirming || hasPendingRows || hasDirtyRows}
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
          <p>{completionMessage(t, confirmation)}</p>
        </div>
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
              <p className="muted">{t("results.meta", { count: preview.rows.length, expires: new Date(preview.expiresAt).toLocaleString() })}</p>
            </div>
            <div className="import-confirmation-actions">
              <p className="import-confirmation-actions__selection">
                <Trans t={t} i18nKey="results.selected" values={{ items: selectedItemsLabel }} components={{ strong: <strong /> }} />
              </p>
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
                  ? t("results.saving", { items: selectedItemsLabel })
                  : t("results.save", { items: selectedItemsLabel })}
              </button>
            </div>
          </div>
          <div className="table-wrapper import-preview-table" role="region" aria-label={t("results.regionLabel")} tabIndex="0">
            <table className="data-table">
              <caption>{t("results.caption")}</caption>
              <thead><tr><th>{t("columns.transaction")}</th><th>{t("columns.status")}</th><th>{t("columns.selection")}</th><th>{t("columns.fields")}</th></tr></thead>
              <tbody>{preview.rows.map((row) => renderRow(row))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
