import {
  LayoutDashboard,
  ShoppingCart,
  Wallet,
  Users,
  Package,
  Tags,
  Boxes,
  Truck,
  Receipt,
  BarChart3,
  PieChart,
  CheckSquare,
  MessageSquare,
  Sparkles,
  UserCog,
  KeyRound,
  ScrollText,
  Settings,
  CreditCard,
  PiggyBank,
  RotateCcw,
  ArrowLeftRight,
  Banknote,
  HandCoins,
  type LucideIcon,
} from "lucide-react";

/**
 * YABUZ OIL & GAS — module navigation.
 * Every entry is gated by permission key(s): the sidebar only shows
 * what the current user is allowed to see (hidden for everyone else).
 */
export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  /** User needs ANY of these permissions to see the item. */
  anyOf: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [
      { title: "Dashboard", path: "/", icon: LayoutDashboard, anyOf: ["dashboard.view"] },
      { title: "Approvals", path: "/approvals", icon: CheckSquare, anyOf: ["approvals.review", "approvals.request"] },
    ],
  },
  {
    label: "Sales & Money",
    items: [
      { title: "Sales", path: "/sales", icon: ShoppingCart, anyOf: ["sales.view"] },
      { title: "Payments", path: "/payments", icon: Wallet, anyOf: ["payments.view"] },
      { title: "Credit", path: "/credit", icon: CreditCard, anyOf: ["credit.view"] },
      { title: "Deposits", path: "/deposits", icon: PiggyBank, anyOf: ["deposits.view"] },
      { title: "Returns", path: "/returns", icon: RotateCcw, anyOf: ["returns.view"] },
      { title: "Exchanges", path: "/exchanges", icon: ArrowLeftRight, anyOf: ["exchanges.view"] },
      { title: "Expenses", path: "/expenses", icon: Receipt, anyOf: ["expenses.view"] },
    ],
  },
  {
    label: "Catalog & Stock",
    items: [
      { title: "Products", path: "/products", icon: Package, anyOf: ["products.view"] },
      { title: "Price Lists", path: "/price-lists", icon: Tags, anyOf: ["prices.view_cost", "prices.manage"] },
      { title: "Inventory", path: "/inventory", icon: Boxes, anyOf: ["inventory.view"] },
      { title: "Purchases", path: "/purchases", icon: Truck, anyOf: ["inventory.manage_purchases"] },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Customers", path: "/customers", icon: Users, anyOf: ["customers.view"] },
      { title: "Staff", path: "/users", icon: UserCog, anyOf: ["users.view"] },
      { title: "Salary", path: "/salary", icon: Banknote, anyOf: ["salary.view"] },
      { title: "Staff Loans", path: "/loans", icon: HandCoins, anyOf: ["loans.view"] },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Reports", path: "/reports", icon: BarChart3, anyOf: ["reports.view"] },
      { title: "Analytics", path: "/analytics", icon: PieChart, anyOf: ["analytics.view"] },
    ],
  },
  {
    label: "Collaboration",
    items: [
      { title: "Team Chat", path: "/chat", icon: MessageSquare, anyOf: ["chat.use"] },
      { title: "AI Assistant", path: "/ai", icon: Sparkles, anyOf: ["ai.use"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Permissions", path: "/permissions", icon: KeyRound, anyOf: ["permissions.manage"] },
      { title: "Audit Log", path: "/audit", icon: ScrollText, anyOf: ["audit.view"] },
      { title: "Settings", path: "/settings", icon: Settings, anyOf: ["settings.business", "settings.workflow", "settings.system"] },
    ],
  },
];
