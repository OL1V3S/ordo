import { useCallback, useEffect, useState } from "react";
import { expensesApi } from "../api/expensesApi";

//fetch/state

export function useExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async function refresh({ rethrow = false } = {}) {
    setLoading(true);
    setError(null);
    try {
      const res = await expensesApi.getAll();
      setExpenses(res.data ?? []);
    } catch (requestError) {
      setExpenses([]);
      setError(requestError);
      if (rethrow) throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function addExpense(payload) {
    await expensesApi.create(payload);
    await refresh({ rethrow: true });
  }

  async function updateExpense(id, payload) {
    await expensesApi.update(id, payload);
    await refresh({ rethrow: true });
  }

  async function deleteExpense(id) {
    await expensesApi.remove(id);
    await refresh({ rethrow: true });
  }

  return { expenses, loading, error, refresh, addExpense, updateExpense, deleteExpense };
}
