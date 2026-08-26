import { useCallback, useEffect, useState } from "react";
import { expensesApi } from "../api/expensesApi";

//fetch/state

export function useExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await expensesApi.getAll();
      setExpenses(res.data ?? []);
    } catch (requestError) {
      setExpenses([]);
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  async function addExpense(payload) {
    await expensesApi.create(payload);
    await refresh();
  }

  async function updateExpense(id, payload) {
    await expensesApi.update(id, payload);
    await refresh();
  }

  async function deleteExpense(id) {
    await expensesApi.remove(id);
    await refresh();
  }

  return { expenses, loading, error, refresh, addExpense, updateExpense, deleteExpense };
}
