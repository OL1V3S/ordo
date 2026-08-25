import { useEffect, useMemo, useState } from "react";
import { useExpenses } from "../../expenses/hooks/useExpenses";

import { filterExpenses } from "../../expenses/utils/filterExpenses";
import { DEFAULT_CATEGORIES } from "../../../shared/constants/categories";
import { normalizeText, isDefaultCategory } from "../../../utils/text";

import ExpenseForm from "../../expenses/components/ExpenseForm";
import ExpenseFilters from "../../expenses/components/ExpenseFilters";
import ExpenseList from "../../expenses/components/ExpenseList";
import ImportPreviewPanel from "../../importPreview/components/ImportPreviewPanel";
import { useImportPreview } from "../../importPreview/hooks/useImportPreview";
const ENTRIES_PER_PAGE = 10;

export default function TransactionsPage() {
  const importState = useImportPreview();
  const {
    expenses,
    loading: expensesLoading,
    refresh: refreshExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
  } = useExpenses();

  // Add expense UI state
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");

  // edit expense
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingExpenseData, setEditingExpenseData] = useState({});

  // filters
  const [dateFilter, setDateFilter] = useState("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // pagination
  const [showAll, setShowAll] = useState(false);

  const filters = useMemo(
    () => ({
      dateFilter,
      customStartDate,
      customEndDate,
      categoryFilter,
      searchTerm,
    }),
    [dateFilter, customStartDate, customEndDate, categoryFilter, searchTerm]
  );

  const filteredExpenses = useMemo(
    () => filterExpenses(expenses, filters),
    [expenses, filters]
  );

  useEffect(() => {
    setShowAll(false);
  }, [filters]);

  const expensesToShow = showAll
    ? filteredExpenses
    : filteredExpenses.slice(0, ENTRIES_PER_PAGE);

  async function handleAddExpense() {
    if (!newName || !newAmount || !newDate || !newCategory) {
      alert("Complete all transaction fields.");
      return;
    }
  
    const categoryToUse =
      newCategory === "other"
        ? normalizeText(customCategory || "uncategorized")
        : normalizeText(newCategory);
  
    const payload = {
      description: normalizeText(newName),
      amount: parseFloat(newAmount),
      date: newDate,
      category: categoryToUse,
    };
  
    await addExpense(payload);
  
    setNewName("");
    setNewAmount("");
    setNewDate("");
    setNewCategory("");
    setCustomCategory("");
  }

  function startEditExpense(expense) {
    const currentCategory = expense.category || "";
    const categoryIsDefault = isDefaultCategory(currentCategory, DEFAULT_CATEGORIES);
  
    setEditingExpenseId(expense.id);
    setEditingExpenseData({
      description: expense.description || "",
      amount: Number(expense.amount ?? 0).toFixed(2),
      date: expense.date || "",
      category: categoryIsDefault ? normalizeText(currentCategory) : "other",
      customCategory: categoryIsDefault ? "" : currentCategory,
    });
  }

  function cancelEditExpense() {
    setEditingExpenseId(null);
    setEditingExpenseData({});
  }

  async function saveExpenseEdit(id) {
    const finalCategory =
      editingExpenseData.category === "other"
        ? normalizeText(editingExpenseData.customCategory || "uncategorized")
        : normalizeText(editingExpenseData.category);
  
    const body = {
      id,
      description: normalizeText(editingExpenseData.description),
      amount: Math.round(parseFloat(editingExpenseData.amount) * 100) / 100,
      date: editingExpenseData.date,
      category: finalCategory,
    };
  
    await updateExpense(id, body);
    cancelEditExpense();
  }

  return (
    <div className="container">
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Your finances</p>
          <h1>Transactions</h1>
          <p className="muted">Record, review, and organize your expenses.</p>
        </div>
      </header>

      <ImportPreviewPanel importState={importState} onImportConfirmed={refreshExpenses} />
  
      <ExpenseForm
        loading={expensesLoading}
        onAdd={handleAddExpense}
        newName={newName}
        setNewName={setNewName}
        newAmount={newAmount}
        setNewAmount={setNewAmount}
        newDate={newDate}
        setNewDate={setNewDate}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        customCategory={customCategory}
        setCustomCategory={setCustomCategory}
      />
  
      <ExpenseFilters
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        customStartDate={customStartDate}
        setCustomStartDate={setCustomStartDate}
        customEndDate={customEndDate}
        setCustomEndDate={setCustomEndDate}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
      />
  
      <ExpenseList
        expenses={expensesToShow}
        filteredCount={filteredExpenses.length}
        entriesPerPage={ENTRIES_PER_PAGE}
        showAll={showAll}
        onShowAll={() => setShowAll(true)}
        editingExpenseId={editingExpenseId}
        editingExpenseData={editingExpenseData}
        setEditingExpenseData={setEditingExpenseData}
        onStartEdit={startEditExpense}
        onSave={saveExpenseEdit}
        onCancel={cancelEditExpense}
        onDelete={deleteExpense}
      />
    </div>
  );
}
