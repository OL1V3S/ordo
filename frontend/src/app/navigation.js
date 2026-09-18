import {
  BarChart3,
  ChartNoAxesCombined,
  Ellipsis,
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

export const MOBILE_DESTINATIONS = [
  { to: "/overview", labelKey: "destinations.home.label", icon: LayoutDashboard, paths: ["/overview"] },
  { to: "/transactions", labelKey: "destinations.activity.label", icon: ReceiptText, paths: ["/transactions"] },
  { to: "/plan", labelKey: "destinations.plan.label", icon: WalletCards, paths: ["/plan", ...PLAN_DESTINATIONS.map(({ to }) => to)] },
  { to: "/analytics", labelKey: "destinations.insights.label", icon: ChartNoAxesCombined, paths: ["/analytics"] },
  { to: "/more", labelKey: "destinations.more.label", icon: Ellipsis, paths: ["/more", ...MORE_DESTINATIONS.map(({ to }) => to)] },
];

export function getMobileDestination(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return MOBILE_DESTINATIONS.find(({ paths }) => paths.includes(path));
}
