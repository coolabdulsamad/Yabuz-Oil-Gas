import { Routes, Route } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";
import Users from "@/pages/Users";
import Permissions from "@/pages/Permissions";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import PriceLists from "@/pages/PriceLists";
import PriceListDetail from "@/pages/PriceListDetail";
import Inventory from "@/pages/Inventory";
import StockCountDetail from "@/pages/StockCountDetail";
import Purchases from "@/pages/Purchases";
import PurchaseDetail from "@/pages/PurchaseDetail";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import Credit from "@/pages/Credit";
import Deposits from "@/pages/Deposits";
import Money from "@/pages/Money";
import Sales from "@/pages/Sales";
import NewSale from "@/pages/NewSale";
import SaleDetail from "@/pages/SaleDetail";
import SaleReceipt from "@/pages/SaleReceipt";
import Approvals from "@/pages/Approvals";
import Payments from "@/pages/Payments";
import Expenses from "@/pages/Expenses";
import Reports from "@/pages/Reports";
import Analytics from "@/pages/Analytics";
import TeamChat from "@/pages/TeamChat";
import AiChat from "@/pages/AiChat";
import AuditLog from "@/pages/AuditLog";
import Returns from "@/pages/Returns";
import Exchanges from "@/pages/Exchanges";
import Salary from "@/pages/Salary";
import Payslip from "@/pages/Payslip";
import Loans from "@/pages/Loans";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Standalone printable receipt — no app shell */}
        <Route path="/sales/:id/receipt" element={<SaleReceipt />} />
        {/* Standalone printable payslip — no app shell */}
        <Route path="/salary/:id/payslip" element={<Payslip />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          {/* Modules land in later build steps — placeholders keep nav explorable */}
          <Route path="/sales" element={<Sales />} />
          <Route path="/sales/new" element={<NewSale />} />
          <Route path="/sales/:id" element={<SaleDetail />} />
          <Route path="/sales/:id/edit" element={<NewSale />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/credit" element={<Credit />} />
          <Route path="/deposits" element={<Deposits />} />
          <Route path="/money" element={<Money />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/exchanges" element={<Exchanges />} />
          <Route path="/salary" element={<Salary />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/price-lists" element={<PriceLists />} />
          <Route path="/price-lists/:id" element={<PriceListDetail />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/counts/:id" element={<StockCountDetail />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/purchases/:id" element={<PurchaseDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/chat" element={<TeamChat />} />
          <Route path="/ai" element={<AiChat />} />
          <Route path="/permissions" element={<Permissions />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
