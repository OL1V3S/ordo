import {
  BarChart3,
  ChartNoAxesCombined,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Repeat2,
  Settings,
} from "lucide-react";

export const APP_DESTINATIONS = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/transactions", label: "Transactions", icon: ReceiptText },
  { to: "/budgets", label: "Budgets", icon: BarChart3 },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/commitments", label: "Commitments", icon: Repeat2 },
  { to: "/investing", label: "Investing", icon: Landmark },
  { to: "/settings", label: "Settings", icon: Settings },
];
