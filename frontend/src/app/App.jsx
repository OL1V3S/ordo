import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import TransactionsPage from "../features/transactions/pages/TransactionsPage";
import BudgetsPage from "../features/budgetLimits/pages/BudgetsPage";
import AnalyticsPage from "../features/analytics/pages/AnalyticsPage";
import CommitmentsPage from "../features/commitments/pages/CommitmentsPage";
import AuthPage from "../features/auth/components/AuthPage";
import ConfirmEmailPage from "../features/auth/components/ConfirmEmailPage";
import ForgotPasswordPage from "../features/auth/components/ForgotPasswordPage";
import ResetPasswordPage from "../features/auth/components/ResetPasswordPage";
import AppShell from "./AppShell";
import ProtectedRoute from "./ProtectedRoute";
import OverviewPage from "./pages/OverviewPage";
import InvestingPage from "./pages/InvestingPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    !!localStorage.getItem("token")
  );

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("email");
    setIsLoggedIn(false);
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          isLoggedIn ? (
            <Navigate to="/overview" replace />
          ) : (
            <AuthPage onLogin={() => setIsLoggedIn(true)} />
          )
        }
      />

      <Route path="/confirm-email" element={<ConfirmEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute isAuthenticated={isLoggedIn} />}>
        <Route element={<AppShell email={localStorage.getItem("email")} onLogout={handleLogout} />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/commitments" element={<CommitmentsPage />} />
          <Route path="/investing" element={<InvestingPage />} />
          <Route path="/settings" element={<SettingsPage email={localStorage.getItem("email")} />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
