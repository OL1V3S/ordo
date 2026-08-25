import client from "../../../shared/api/client";

export const importPreviewApi = {
  upload(sourceType, file, signal) {
    const body = new FormData();
    body.append("sourceType", sourceType);
    body.append("file", file);
    return client.post("/api/import-previews", body, { signal });
  },
  getOpen(sourceType, signal) {
    return client.get("/api/import-previews/open", {
      params: { sourceType },
      signal,
    });
  },
  getById(batchId, signal) {
    return client.get(`/api/import-previews/${batchId}`, { signal });
  },
  updateRow(batchId, rowId, payload) {
    return client.patch(`/api/import-previews/${batchId}/rows/${rowId}`, payload);
  },
};
