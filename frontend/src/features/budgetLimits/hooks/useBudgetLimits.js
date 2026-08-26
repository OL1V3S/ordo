import { useCallback, useEffect, useRef, useState } from "react";
import { budgetLimitsApi } from "../api/budgetLimitsApi";

export function useBudgetLimits(monthYear) {
  const [budgetLimits, setBudgetLimits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const refresh = useCallback(async function refresh({ rethrow = false } = {}) {
    if (!monthYear) return;
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setError(null);
    setBudgetLimits([]);
    try {
      const res = await budgetLimitsApi.getByMonth(monthYear);
      if (currentRequestId === requestId.current) setBudgetLimits(res.data ?? []);
    } catch (requestError) {
      if (currentRequestId === requestId.current) {
        setError(requestError);
        if (rethrow) throw requestError;
      }
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [monthYear]);

  useEffect(() => {
    refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);

  async function upsertLimit(payload) {
    await budgetLimitsApi.upsert(payload);
    await refresh({ rethrow: true });
  }

  async function deleteLimit(id) {
    await budgetLimitsApi.remove(id);
    await refresh({ rethrow: true });
  }

  return { budgetLimits, loading, error, refresh, upsertLimit, deleteLimit };
}
