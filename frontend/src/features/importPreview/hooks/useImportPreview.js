import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { importPreviewApi } from "../api/importPreviewApi";

const SAFE_ERRORS = {
  upload_too_large: "Choose a PDF that is 10 MiB or smaller.",
  invalid_pdf: "This file is not a valid supported PDF.",
  encrypted_pdf: "Encrypted or password-protected PDFs are not supported.",
  image_only_pdf: "This PDF has no extractable text. Scanned statements are not supported yet.",
  unsupported_statement_source: "The selected statement source is not supported.",
  source_required: "Choose a supported bank before uploading.",
  unsupported_statement_format: "This Sunflower statement format is not supported.",
  candidate_row_limit_exceeded: "This statement contains more than 1,000 transaction rows.",
  processing_timed_out: "Statement processing timed out. Try the upload again.",
  processing_cancelled: "Statement processing was cancelled.",
  import_in_progress: "Another statement is already being processed.",
  already_imported: "This statement was already imported. No duplicate financial records were created.",
  row_not_selectable: "That row cannot be selected for import.",
  row_validation_failed: "Check the row details, then try again.",
};

const CONFIRMATION_MESSAGES = {
  no_rows_selected: "Select at least one eligible row before confirming.",
  duplicate_review_required: "New possible duplicates were found. Review the affected rows and explicitly select any row you still want to import.",
  confirmation_validation_failed: "One or more selected rows need attention before the import can be confirmed.",
  confirmation_conflict: "The statement could not be confirmed because its import state changed. Review the preview and try again.",
  confirmation_failed: "The statement could not be confirmed safely. Nothing is being reported as imported; you can try again.",
  preview_expired: "This preview expired. Re-upload the statement to create a new review.",
  preview_unavailable: "This import preview is unavailable. Choose the bank and upload the statement again.",
};

const SAFE_CONFIRMATION_ROW_CODES = new Set([
  "possible_duplicate",
  "possible_inflow_duplicate",
  "row_not_selectable",
  "date_required",
  "amount_must_be_positive",
  "amount_out_of_range",
  "amount_precision_invalid",
  "description_required",
  "description_too_long",
  "category_required",
  "category_too_long",
  "category_reserved",
]);

function safeError(error, fallback) {
  const code = error?.response?.data?.code;
  return SAFE_ERRORS[code] ?? fallback;
}

function safeConfirmationRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row?.rowId !== "string" || !Array.isArray(row.codes)) return [];
    const codes = row.codes.filter((code) => SAFE_CONFIRMATION_ROW_CODES.has(code));
    return codes.length > 0 ? [{ rowId: row.rowId, codes }] : [];
  });
}

function safeConfirmationIssue(error) {
  const status = error?.response?.status;
  const responseData = error?.response?.data;
  const responseCode = typeof responseData?.code === "string" ? responseData.code : "";
  const code = status === 404
    ? "preview_unavailable"
    : Object.hasOwn(CONFIRMATION_MESSAGES, responseCode)
      ? responseCode
      : "confirmation_failed";
  return {
    code,
    message: CONFIRMATION_MESSAGES[code],
    rows: safeConfirmationRows(responseData?.rows),
    requiresPreviewRefresh: false,
  };
}

function isConfirmationResponse(value, batchId) {
  return value
    && value.batchId === batchId
    && (value.status === "confirmed" || value.status === "already_confirmed")
    && typeof value.confirmedAt === "string"
    && Number.isInteger(value.importedExpenseCount)
    && value.importedExpenseCount >= 0
    && Number.isInteger(value.importedInflowCount)
    && value.importedInflowCount >= 0;
}

function batchIdFromLocation() {
  return new URLSearchParams(window.location.search).get("importBatch");
}

function rememberBatch(batchId) {
  const url = new URL(window.location.href);
  url.searchParams.set("importBatch", batchId);
  window.history.replaceState({}, "", url);
}

function forgetBatch() {
  const url = new URL(window.location.href);
  url.searchParams.delete("importBatch");
  window.history.replaceState({}, "", url);
}

export function useImportPreview() {
  const [preview, setPreview] = useState(null);
  const [sourceType, setSourceType] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationIssue, setConfirmationIssue] = useState(null);
  const processingController = useRef(null);
  const confirmationInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function resume() {
      try {
        const batchId = batchIdFromLocation();
        if (!batchId) return;
        const response = await importPreviewApi.getById(batchId, controller.signal);
        if (response.status !== 204 && response.data) {
          setPreview(response.data);
          setSourceType(response.data.sourceType);
          rememberBatch(response.data.batchId);
        }
      } catch (requestError) {
        if (!axios.isCancel(requestError)) {
          if (requestError?.response?.status === 404) {
            forgetBatch();
            setError(CONFIRMATION_MESSAGES.preview_unavailable);
          } else {
            setError(safeError(requestError, "The saved import preview could not be loaded."));
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    resume();
    return () => {
      controller.abort();
      processingController.current?.abort();
    };
  }, []);

  const selectSource = useCallback(async (nextSourceType) => {
    processingController.current?.abort();
    setSourceType(nextSourceType);
    setPreview(null);
    setError("");
    setConfirmation(null);
    setConfirmationIssue(null);
    if (!nextSourceType) {
      setLoading(false);
      return null;
    }

    const controller = new AbortController();
    processingController.current = controller;
    setLoading(true);
    try {
      const response = await importPreviewApi.getOpen(nextSourceType, controller.signal);
      if (response.status !== 204 && response.data) {
        setPreview(response.data);
        rememberBatch(response.data.batchId);
        return response.data;
      }
      return null;
    } catch (requestError) {
      if (!axios.isCancel(requestError)) {
        setError(safeError(requestError, "The saved import preview could not be loaded."));
      }
      return null;
    } finally {
      if (processingController.current === controller) processingController.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const upload = useCallback(async (file) => {
    processingController.current?.abort();
    const controller = new AbortController();
    processingController.current = controller;
    setProcessing(true);
    setError("");
    setConfirmation(null);
    setConfirmationIssue(null);
    try {
      const response = await importPreviewApi.upload(sourceType, file, controller.signal);
      setPreview(response.data);
      rememberBatch(response.data.batchId);
      return response.data;
    } catch (requestError) {
      if (!axios.isCancel(requestError)) {
        setError(safeError(requestError, "The statement could not be processed safely."));
      }
      return null;
    } finally {
      if (processingController.current === controller) {
        processingController.current = null;
        setProcessing(false);
      }
    }
  }, [sourceType]);

  const cancel = useCallback(() => processingController.current?.abort(), []);

  const updateRow = useCallback(async (rowId, payload) => {
    if (!preview) return null;
    setError("");
    try {
      const response = await importPreviewApi.updateRow(preview.batchId, rowId, payload);
      setPreview((current) => ({
        ...current,
        rows: current.rows.map((row) => row.rowId === rowId ? response.data : row),
      }));
      setConfirmationIssue((current) => {
        if (!current) return null;
        if (current.code === "no_rows_selected"
          && (payload.selectedForImport || payload.selectedForInflow)) return null;
        if (!current.rows.some((row) => row.rowId === rowId)) return current;
        return {
          ...current,
          rows: current.rows.filter((row) => row.rowId !== rowId),
        };
      });
      return response.data;
    } catch (requestError) {
      setError(safeError(requestError, "The preview row could not be updated."));
      return null;
    }
  }, [preview]);

  const confirm = useCallback(async () => {
    if (!preview || confirmationInFlight.current) return null;
    const batchId = preview.batchId;
    confirmationInFlight.current = true;
    setConfirming(true);
    setConfirmationIssue(null);
    setError("");
    try {
      const response = await importPreviewApi.confirm(batchId);
      if (!isConfirmationResponse(response.data, batchId)) {
        setConfirmationIssue({
          code: "confirmation_failed",
          message: CONFIRMATION_MESSAGES.confirmation_failed,
          rows: [],
          requiresPreviewRefresh: false,
        });
        return null;
      }

      setConfirmation(response.data);
      setPreview(null);
      forgetBatch();
      return response.data;
    } catch (requestError) {
      const issue = safeConfirmationIssue(requestError);
      if (issue.code === "duplicate_review_required") {
        try {
          const refreshed = await importPreviewApi.getById(batchId);
          if (!refreshed.data) throw new Error("Preview refresh returned no data.");
          setPreview(refreshed.data);
        } catch {
          issue.requiresPreviewRefresh = true;
          issue.message = "New duplicate warnings were saved, but the latest preview could not be loaded. Refresh this page before confirming.";
        }
      } else if (issue.code === "preview_unavailable" || issue.code === "preview_expired") {
        setPreview(null);
        forgetBatch();
      }
      setConfirmationIssue(issue);
      return null;
    } finally {
      confirmationInFlight.current = false;
      setConfirming(false);
    }
  }, [preview]);

  const clearForReupload = useCallback(() => {
    setPreview(null);
    setError("");
    setConfirmation(null);
    setConfirmationIssue(null);
    forgetBatch();
  }, []);

  const selectedCount = preview?.rows.filter((row) =>
    (row.isEligible && row.selectedForImport)
    || (row.isInflowEligible && row.selectedForInflow)).length ?? 0;

  return {
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
  };
}
