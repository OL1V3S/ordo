import { useRef, useState } from "react";
import Card from "../../../shared/ui/Card";
import ImportPreviewRow from "./ImportPreviewRow";

export default function ImportPreviewPanel({ importState }) {
  const { preview, sourceType, loading, processing, error, selectSource, upload, cancel, updateRow, clearForReupload } = importState;
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const resultsHeading = useRef(null);

  async function submitFile(file) {
    if (!file || !sourceType) return;
    const result = await upload(file);
    if (result) requestAnimationFrame(() => resultsHeading.current?.focus());
  }

  function drop(event) {
    event.preventDefault();
    setDragging(false);
    if (!sourceType) return;
    submitFile(event.dataTransfer.files?.[0]);
  }

  return (
    <Card as="section" className="section import-preview" aria-labelledby="import-preview-title">
      <div className="section__header import-preview__header">
        <div>
          <p className="page-header__eyebrow">Preview only</p>
          <h2 className="h2" id="import-preview-title">Import bank statement</h2>
          <p className="muted">Choose the bank, then upload a text-extractable PDF up to 10 MiB. Scanned statements are not supported.</p>
        </div>
        {preview && <button type="button" className="button-ghost" onClick={clearForReupload}>Choose another statement</button>}
      </div>

      <div className="status-message status-message--info">
        Preview only — no expenses have been created. Confirmation is not available yet.
      </div>

      <div className="import-source-control">
        <label htmlFor="statement-source">Bank</label>
        <select
          id="statement-source"
          required
          value={sourceType}
          disabled={processing || Boolean(preview)}
          onChange={(event) => selectSource(event.target.value)}
        >
          <option value="">Choose a bank</option>
          <option value="sunflower_pdf">Sunflower Bank</option>
        </select>
        {!sourceType && <p className="muted">Choose a bank to enable PDF upload.</p>}
      </div>

      {error && <div className="status-message status-message--danger" role="alert">{error}</div>}
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
            <h3 className="h3" ref={resultsHeading} tabIndex="-1">Statement preview</h3>
            <p className="muted">{preview.rows.length} rows · available until {new Date(preview.expiresAt).toLocaleString()}</p>
          </div>
          <div className="table-wrapper import-preview-table" role="region" aria-label="Statement import preview" tabIndex="0">
            <table className="data-table">
              <caption>Sunflower Bank statement rows</caption>
              <thead><tr><th>Row</th><th>Statement details</th><th>Status</th><th>Selection</th><th>Expense fields</th></tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <ImportPreviewRow key={row.rowId} row={row} onUpdate={(payload) => updateRow(row.rowId, payload)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-preview-cards">
            {preview.rows.map((row) => (
              <ImportPreviewRow key={row.rowId} row={row} presentation="card" onUpdate={(payload) => updateRow(row.rowId, payload)} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
