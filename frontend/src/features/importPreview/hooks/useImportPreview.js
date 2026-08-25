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
  row_not_selectable: "That row cannot be selected for import.",
  row_validation_failed: "Check the description and category, then try again.",
};

function safeError(error, fallback) {
  const code = error?.response?.data?.code;
  return SAFE_ERRORS[code] ?? fallback;
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
  const processingController = useRef(null);

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
          setError(safeError(requestError, "The saved import preview could not be loaded."));
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
      return response.data;
    } catch (requestError) {
      setError(safeError(requestError, "The preview row could not be updated."));
      return null;
    }
  }, [preview]);

  const clearForReupload = useCallback(() => {
    setPreview(null);
    setError("");
    forgetBatch();
  }, []);

  return {
    preview,
    sourceType,
    loading,
    processing,
    error,
    selectSource,
    upload,
    cancel,
    updateRow,
    clearForReupload,
  };
}
