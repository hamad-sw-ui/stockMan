import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import PinLoginPage from './pages/vendor/pin-login/PinLoginPage';
import NotFound from './pages/NotFound';

// Super Admin Pages
import SuperAdminDashboard from './pages/superadmin/Dashboard';
import SuperAdminDepots from './pages/superadmin/Depots';
import SuperAdminUsers from './pages/superadmin/Users';
import SuperAdminSettings from './pages/superadmin/Settings';
import SuperAdminReports from './pages/superadmin/Reports';
import TenantsListPage from './pages/superadmin/tenants/TenantsListPage';
import LicencesPage from './pages/superadmin/licences/LicencesPage';
import ModulesPage from './pages/superadmin/modules/ModulesPage';
import LogsPage from './pages/superadmin/logs/LogsPage';

// Admin Pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminStock from './pages/admin/Stock';
import AdminSales from './pages/admin/Sales';
import AdminVendors from './pages/admin/Vendors';
import AdminSuppliers from './pages/admin/Suppliers';
import AdminReports from './pages/admin/Reports';
import BrandingSettings from './pages/admin/branding/BrandingSettings';
import UnitsConfig from './pages/admin/units/UnitsConfig';

// Vendor Pages
import VendorDashboard from './pages/vendor/Dashboard';
import VendorQuickSale from './pages/vendor/QuickSale';
import VendorSalesHistory from './pages/vendor/SalesHistory';
import VendorStockView from './pages/vendor/StockView';
import VendorDayClose from './pages/vendor/DayClose';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/login-pin" element={<PinLoginPage />} />
            
            {/* Redirect root to login */}
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Super Admin Routes */}
            <Route
              path="/superadmin/dashboard"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <SuperAdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/tenants"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <TenantsListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/licences"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <LicencesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/modules"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <ModulesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/logs"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <LogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/depots"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <SuperAdminDepots />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/users"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <SuperAdminUsers />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/settings"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <SuperAdminSettings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/superadmin/reports"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <SuperAdminReports />
                </ProtectedRoute>
              }
            />

            {/* Admin Routes */}
            <Route
              path="/admin/dashboard"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/units"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <UnitsConfig />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/stock"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminStock />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/sales"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminSales />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/vendors"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminVendors />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/suppliers"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminSuppliers />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/reports"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminReports />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/branding"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <BrandingSettings />
                </ProtectedRoute>
              }
            />

            {/* Vendor Routes */}
            <Route
              path="/vendor/dashboard"
              element={
                <ProtectedRoute allowedRoles={['VENDEUR']}>
                  <VendorDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendor/quick-sale"
              element={
                <ProtectedRoute allowedRoles={['VENDEUR']}>
                  <VendorQuickSale />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendor/sales-history"
              element={
                <ProtectedRoute allowedRoles={['VENDEUR']}>
                  <VendorSalesHistory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendor/stock"
              element={
                <ProtectedRoute allowedRoles={['VENDEUR']}>
                  <VendorStockView />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vendor/day-close"
              element={
                <ProtectedRoute allowedRoles={['VENDEUR']}>
                  <VendorDayClose />
                </ProtectedRoute>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;