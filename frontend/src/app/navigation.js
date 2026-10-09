import {
  BarChart3,
  ClipboardList,
  ChartNoAxesCombined,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Repeat2,
  Settings,
  WalletCards,
} from "lucide-react";

export const APP_DESTINATIONS = [
  { to: "/overview", labelKey: "destinations.home.label", icon: LayoutDashboard },
  { to: "/transactions", labelKey: "destinations.activity.label", icon: ReceiptText },
  { to: "/budgets", labelKey: "destinations.budgets.label", icon: BarChart3, descriptionKey: "destinations.budgets.description" },
  { to: "/analytics", labelKey: "destinations.insights.label", icon: ChartNoAxesCombined },
  { to: "/commitments", labelKey: "destinations.commitments.label", icon: Repeat2, descriptionKey: "destinations.commitments.description" },
  { to: "/paychecks", labelKey: "destinations.paychecks.label", icon: WalletCards, descriptionKey: "destinations.paychecks.description" },
  { to: "/investing", labelKey: "destinations.investing.label", icon: Landmark, descriptionKey: "destinations.investing.description" },
  { to: "/settings", labelKey: "destinations.settings.label", icon: Settings, descriptionKey: "destinations.settings.description" },
];

export const PLAN_DESTINATIONS = APP_DESTINATIONS.filter(({ to }) =>
  ["/budgets", "/commitments", "/paychecks"].includes(to));
export const MORE_DESTINATIONS = ["/settings", "/investing"]
  .map((to) => APP_DESTINATIONS.find((destination) => destination.to === to));

export const ACCOUNT_DESTINATIONS = MORE_DESTINATIONS;

export const PRIMARY_DESTINATIONS = [
  { to: "/overview", labelKey: "destinations.home.label", icon: LayoutDashboard, paths: ["/overview"] },
  { to: "/transactions", labelKey: "destinations.activity.label", icon: ReceiptText, paths: ["/transactions"] },
  {
    to: "/plan",
    labelKey: "destinations.plan.label",
    icon: ClipboardList,
    paths: ["/plan", ...PLAN_DESTINATIONS.map(({ to }) => to)],
    children: PLAN_DESTINATIONS,
  },
  { to: "/analytics", labelKey: "destinations.insights.label", icon: ChartNoAxesCombined, paths: ["/analytics"] },
];

export function normalizePath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

export function getPrimaryDestination(pathname) {
  const path = normalizePath(pathname);
  return PRIMARY_DESTINATIONS.find(({ paths }) => paths.includes(path));
}

export function getPageLabelKey(pathname) {
  const path = normalizePath(pathname);
  return APP_DESTINATIONS.find((destination) => destination.to === path)?.labelKey
    ?? getPrimaryDestination(path)?.labelKey
    ?? (path === "/more" ? "destinations.more.label" : null);
}
