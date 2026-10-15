import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inflowsApi } from "../../inflows/api/inflowsApi";
import { paychecksApi } from "../../paychecks/api/paychecksApi";
import {
  buildLinkIntent,
  importPaycheckSuggestions,
  isSuggestionCandidateRow,
  resolveLinkTarget,
} from "../utils/importPaycheckSuggestions";
import { isDepositSelected, savedRowsMatchConfirmation } from "../utils/importReview";

// Advisory paycheck suggestions for the deposit rows of an unsaved statement review, and the
// opt-in "save, then link" step. Linking is a second request after the statement is saved, so it
// is not atomic: a deposit whose link fails stays saved and unlinked. Nothing is linked unless
// the user ticked "Link to ..." for that row, every gate below holds, and the backend accepts the
// existing receipt write (it re-validates slot, ownership and availability itself).

const NO_DATA = { batchId: null, status: "idle", paychecks: [], inflows: [] };
const EMPTY = new Map();

// No response, a server error or a timeout means the write may have committed.
function receiptFailureStatus(error) {
  const status = error?.response?.status;
  if (typeof status !== "number" || status >= 500 || status === 408) return "uncertain";
  return status === 409 ? "changed" : "failed";
}

async function readCurrentState() {
  try {
    const [paycheckResponse, inflowResponse] = await Promise.all([paychecksApi.getPaychecks(), inflowsApi.getAll()]);
    const paychecks = paycheckResponse?.data?.paychecks;
    const inflows = inflowResponse?.data;
    return Array.isArray(paychecks) && Array.isArray(inflows) ? { paychecks, inflows } : null;
  } catch {
    return null;
  }
}

function resultItem(intent, status, retry = null) {
  return {
    rowId: intent.rowId,
    name: intent.name,
    description: intent.description,
    date: intent.date,
    amount: intent.amount,
    status,
    retry,
    retried: false,
  };
}

export function useImportPaycheckLinks({ preview }) {
  const batchId = preview?.batchId ?? null;
  const rows = preview?.rows;
  const wantsData = useMemo(() => rows?.some(isSuggestionCandidateRow) ?? false, [rows]);
  const [data, setData] = useState(NO_DATA);
  const [intents, setIntents] = useState({ batchId: null, rowIds: [] });
  const [results, setResults] = useState(null);
  const [linking, setLinking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const mounted = useRef(true);
  const retrying = useRef(false);
  // Bumped whenever results are reset or a new batch opens; a late result from an older run is dropped.
  const runToken = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Read the schedules and deposits once per open preview. A failed read means no suggestions
  // and no toggle (fail closed); the rest of the review is unaffected.
  useEffect(() => {
    if (!batchId || !wantsData) return undefined;
    let active = true;
    setData((current) => current.batchId === batchId ? current : { ...NO_DATA, batchId, status: "loading" });
    readCurrentState().then((state) => {
      if (!active) return;
      setData((current) => current.batchId !== batchId ? current
        : state ? { batchId, status: "ready", ...state } : { ...NO_DATA, batchId, status: "failed" });
    });
    return () => { active = false; };
  }, [batchId, wantsData]);

  useEffect(() => {
    runToken.current += 1;
    if (batchId) setResults(null);
  }, [batchId]);

  const suggestions = useMemo(() => {
    if (!rows || data.batchId !== batchId || data.status !== "ready") return EMPTY;
    return new Map(importPaycheckSuggestions({ rows, paychecks: data.paychecks, inflows: data.inflows })
      .map((suggestion) => [suggestion.row.rowId, suggestion]));
  }, [rows, data, batchId]);

  // An intent only lives while its row is still selected and still has a suggestion, so an
  // unselected row, a bulk clear, or a row the server deselected as a duplicate drops it.
  useEffect(() => {
    setIntents((current) => {
      if (current.rowIds.length === 0) return current;
      const selected = new Set((rows ?? []).filter(isDepositSelected).map((row) => row.rowId));
      const keep = current.batchId === batchId
        ? current.rowIds.filter((rowId) => selected.has(rowId) && suggestions.has(rowId))
        : [];
      return keep.length === current.rowIds.length && current.batchId === batchId
        ? current
        : { batchId, rowIds: keep };
    });
  }, [rows, suggestions, batchId]);

  const intentSet = useMemo(
    () => new Set(intents.batchId === batchId ? intents.rowIds : []),
    [intents, batchId],
  );

  const setIntent = useCallback((rowId, on) => {
    setIntents((current) => {
      const base = current.batchId === batchId ? current.rowIds : [];
      const next = on ? [...new Set([...base, rowId])] : base.filter((id) => id !== rowId);
      return { batchId, rowIds: next };
    });
  }, [batchId]);

  // Captured when the user presses Save: the chosen links plus a fresh list of the deposit ids
  // that exist before saving, so the deposit this import creates can be identified afterwards.
  const prepare = useCallback(async () => {
    const chosen = (rows ?? [])
      .filter((row) => isDepositSelected(row) && intentSet.has(row.rowId) && suggestions.has(row.rowId))
      .map((row) => buildLinkIntent(row, suggestions.get(row.rowId)));
    if (chosen.length === 0) return null;
    setPreparing(true);
    let snapshotIds = null;
    try {
      const response = await inflowsApi.getAll();
      if (Array.isArray(response?.data)) snapshotIds = new Set(response.data.map((inflow) => String(inflow.id)));
    } catch {
      snapshotIds = null;
    } finally {
      if (mounted.current) setPreparing(false);
    }
    return { intents: chosen, snapshotIds };
  }, [rows, intentSet, suggestions]);

  const linkAfterConfirm = useCallback(async ({ plan, confirmation, savedRows }) => {
    if (!plan || plan.intents.length === 0) return;
    const token = runToken.current + 1;
    runToken.current = token;
    const isCurrent = () => mounted.current && runToken.current === token;
    setResults(null);
    setLinking(true);
    // (a) this action created the saved deposits, (b) the saved rows match the counts, and the
    // pre-save deposit list is known.
    const gated = confirmation?.status === "confirmed"
      && savedRowsMatchConfirmation(savedRows, confirmation)
      && plan.snapshotIds instanceof Set;
    const items = [];
    const usedIds = new Set();
    try {
      for (const intent of plan.intents) {
        if (!mounted.current) return;
        if (!gated) {
          items.push(resultItem(intent, plan.snapshotIds ? "changed" : "failed"));
          continue;
        }
        // Linking advances the pay schedule's open slots, so read fresh state for every link.
        const state = await readCurrentState();
        if (!state) {
          items.push(resultItem(intent, "failed"));
          continue;
        }
        const target = resolveLinkTarget({ intent, snapshotIds: plan.snapshotIds, usedIds, ...state });
        if (!target.ok) {
          items.push(resultItem(intent, "changed"));
          continue;
        }
        usedIds.add(String(target.inflowId));
        try {
          await paychecksApi.recordReceipt(target.profileId, {
            slotAnchor: target.slotAnchor,
            existingInflowId: Number(target.inflowId),
          });
          items.push(resultItem(intent, "linked"));
        } catch (error) {
          const status = receiptFailureStatus(error);
          items.push(resultItem(intent, status, status === "uncertain" ? target : null));
        }
      }
      if (isCurrent()) setResults({ items });
    } finally {
      if (isCurrent()) setLinking(false);
    }
  }, []);

  // One manual retry of an uncertain link, with exactly the same request. It is idempotent.
  const retry = useCallback(async (rowId) => {
    const item = results?.items.find((entry) => entry.rowId === rowId);
    if (!item?.retry || item.retried || retrying.current) return;
    retrying.current = true;
    const target = item.retry;
    const token = runToken.current;
    let status = "linked";
    try {
      await paychecksApi.recordReceipt(target.profileId, {
        slotAnchor: target.slotAnchor,
        existingInflowId: Number(target.inflowId),
      });
    } catch (error) {
      status = receiptFailureStatus(error);
    } finally {
      retrying.current = false;
    }
    if (!mounted.current || runToken.current !== token) return;
    setResults((current) => current && {
      items: current.items.map((entry) => entry.rowId === rowId
        ? { ...entry, status, retry: null, retried: true }
        : entry),
    });
  }, [results]);

  const reset = useCallback(() => {
    runToken.current += 1;
    setResults(null);
    setLinking(false);
  }, []);

  return {
    suggestionFor: (rowId) => suggestions.get(rowId) ?? null,
    hasIntent: (rowId) => intentSet.has(rowId),
    setIntent,
    prepare,
    linkAfterConfirm,
    retry,
    reset,
    results,
    linking,
    preparing,
  };
}
