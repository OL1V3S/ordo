import { useSyncExternalStore } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { getSessionSnapshot, subscribeToSession } from "../shared/auth/session";
import { getBootStatus, signOut, subscribeToBootRefresh } from "../shared/auth/webSession";

import TransactionsPage from "../features/transactions/pages/TransactionsPage";
import BudgetsPage from "../features/budgetLimits/pages/BudgetsPage";
import AnalyticsPage from "../features/analytics/pages/AnalyticsPage";
import CommitmentsPage from "../features/commitments/pages/CommitmentsPage";
import PaychecksPage from "../features/paychecks/pages/PaychecksPage";
import AuthPage from "../features/auth/components/AuthPage";
import ConfirmEmailPage from "../features/auth/components/ConfirmEmailPage";
import ForgotPasswordPage from "../features/auth/components/ForgotPasswordPage";
import ResetPasswordPage from "../features/auth/components/ResetPasswordPage";
import RequestReferenceNotice from "../shared/ui/RequestReferenceNotice";
import AppShell from "./AppShell";
import BootScreen from "./BootScreen";
import ProtectedRoute from "./ProtectedRoute";
import OverviewPage from "./pages/OverviewPage";
import InvestingPage from "./pages/InvestingPage";
import SettingsPage from "./pages/SettingsPage";
import PlanLayout from "./PlanLayout";
import MorePage from "./pages/MorePage";

export default function App() {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const isLoggedIn = session.signedIn;
  // While the page-load refresh may still restore a session, show a loading view
  // rather than the sign-in page. With a stored sign-in it lasts until the refresh
  // settles, however slow the server is (see webSession.js).
  const boot = useSyncExternalStore(subscribeToBootRefresh, getBootStatus);
  const awaitingSession = boot.pending && !isLoggedIn;
  const loadingView = <BootScreen status={boot} />;

  return (
    <>
      <RequestReferenceNotice />
      <Routes>
        <Route
          path="/"
          element={
            isLoggedIn ? (
              <Navigate to="/overview" replace />
            ) : awaitingSession ? loadingView : (
              <AuthPage />
            )
          }
        />

        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<ProtectedRoute key={session.generation} isAuthenticated={isLoggedIn} isPending={awaitingSession} pendingElement={loadingView} />}>
          <Route element={<AppShell email={session.email} onLogout={signOut} />}>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route element={<PlanLayout />}>
              <Route path="/plan" element={<BudgetsPage key="plan" />} />
              <Route path="/budgets" element={<BudgetsPage />} />
              <Route path="/commitments" element={<CommitmentsPage />} />
              <Route path="/paychecks" element={<PaychecksPage />} />
            </Route>
            <Route path="/more" element={<MorePage />} />
            <Route path="/investing" element={<InvestingPage />} />
            <Route path="/settings" element={<SettingsPage email={session.email} />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  );
}
