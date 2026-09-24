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
      if (!Array.isArray(res?.data)) throw new Error("Invalid expense list response.");
      setExpenses(res.data);
    } catch (requestError) {
      setExpenses([]);
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  // A successful write remains successful if the following list read fails.
  // Let the page explain that distinction without inviting a duplicate create.
  async function refreshAfterWrite() {
    try {
      await refresh();
      return { refreshFailed: false };
    } catch {
      return { refreshFailed: true };
    }
  }

  async function addExpense(payload) {
    await expensesApi.create(payload);
    return refreshAfterWrite();
  }

  async function updateExpense(id, payload) {
    await expensesApi.update(id, payload);
    return refreshAfterWrite();
  }

  async function deleteExpense(id) {
    await expensesApi.remove(id);
    return refreshAfterWrite();
  }

  return { expenses, loading, error, refresh, addExpense, updateExpense, deleteExpense };
}
