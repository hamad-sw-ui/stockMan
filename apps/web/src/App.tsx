/** Routeur applicatif : gardes d'authentification et de rôle, redirections
 *  vers l'espace du rôle (ADMIN → /admin, VENDEUR → /caisse, SA → /sa). */
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  type RouteProps,
} from "react-router-dom";
import Shell from "./components/Shell";
import { Spinner } from "./components/ui";
import { useAuth, type Role } from "./store/auth";
import type { ReactNode } from "react";

// Pages publiques
import LoginPage from "./pages/public/LoginPage";
import RegisterPage from "./pages/public/RegisterPage";
import ForgotPasswordPage from "./pages/public/ForgotPasswordPage";
import ResetPasswordPage from "./pages/public/ResetPasswordPage";

// Espace gérant
import DashboardPage from "./pages/admin/DashboardPage";
import ProductsPage from "./pages/admin/ProductsPage";
import ProductFormPage from "./pages/admin/ProductFormPage";
import ProductDetailPage from "./pages/admin/ProductDetailPage";
import CategoriesPage from "./pages/admin/CategoriesPage";
import UnitsPage from "./pages/admin/UnitsPage";
import DepotsPage from "./pages/admin/DepotsPage";
import SuppliersPage from "./pages/admin/SuppliersPage";
import CustomersPage from "./pages/admin/CustomersPage";
import QuotesPage from "./pages/admin/QuotesPage";
import PurchaseOrdersPage from "./pages/admin/PurchaseOrdersPage";
import ReceiptsPage from "./pages/admin/ReceiptsPage";
import InventoryPage from "./pages/admin/InventoryPage";
import MovementsPage from "./pages/admin/MovementsPage";
import SalesPage from "./pages/admin/SalesPage";
import SaleDetailPage from "./pages/admin/SaleDetailPage";
import VendorsPage from "./pages/admin/VendorsPage";
import ReportsPage from "./pages/admin/ReportsPage";
import NotificationsPage from "./pages/admin/NotificationsPage";
import SettingsPage from "./pages/admin/SettingsPage";
import SubscriptionPage from "./pages/admin/SubscriptionPage";
import AuditPage from "./pages/admin/AuditPage";

// Espace caisse
import PosPage from "./pages/vendor/PosPage";
import PaymentsPage from "./pages/vendor/PaymentsPage";
import StockPage from "./pages/vendor/StockPage";
import ZReportPage from "./pages/vendor/ZReportPage";
import SyncQueuePage from "./pages/vendor/SyncQueuePage";
import CashSessionPage from "./pages/vendor/CashSessionPage";
import CashSessionsPage from "./pages/admin/CashSessionsPage";
import InvoicesPage from "./pages/admin/InvoicesPage";
import PromotionsPage from "./pages/admin/PromotionsPage";

// Console éditeur
import SaDashboardPage from "./pages/sa/SaDashboardPage";
import SaTenantsPage from "./pages/sa/SaTenantsPage";
import SaTenantDetailPage from "./pages/sa/SaTenantDetailPage";
import SaLicensesPage from "./pages/sa/SaLicensesPage";
import SaPlansPage from "./pages/sa/SaPlansPage";
import SaConfigsPage from "./pages/sa/SaConfigsPage";
import SaSupervisionPage from "./pages/sa/SaSupervisionPage";

function homeFor(role?: Role): string {
  return role === "SUPER_ADMIN"
    ? "/sa"
    : role === "ADMIN"
      ? "/admin"
      : "/caisse";
}

function Splash() {
  return (
    <div
      className="center"
      style={{ minHeight: "100vh", flexDirection: "column", gap: 14 }}
    >
      <div
        className="pos-total"
        style={{
          borderRadius: 20,
          width: 56,
          height: 56,
          display: "grid",
          placeItems: "center",
          fontSize: "1.6rem",
        }}
      >
        📦
      </div>
      <Spinner label="Ouverture de StockMan…" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  if (booting) return <Splash />;
  if (!user)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role))
    return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function RedirectHome() {
  const { user, booting } = useAuth();
  if (booting) return <Splash />;
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

/** Page publique : si déjà connecté, redirige vers l'espace du rôle. */
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  if (booting) return <Splash />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div
      className="center"
      style={{ minHeight: "70vh", flexDirection: "column", gap: 8 }}
    >
      <span style={{ fontSize: "3rem" }} aria-hidden>
        🧭
      </span>
      <h1>Page introuvable</h1>
      <p className="muted">Le lien est incorrect ou la page a été déplacée.</p>
      <a className="btn btn-primary" href="/">
        Retour à l’accueil
      </a>
    </div>
  );
}

const route = (path: string, element: RouteProps["element"]) => (
  <Route key={path} path={path} element={element} />
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectHome />} />
      {route(
        "/login",
        <PublicOnly>
          <LoginPage />
        </PublicOnly>,
      )}
      {route(
        "/inscription",
        <PublicOnly>
          <RegisterPage />
        </PublicOnly>,
      )}
      {route(
        "/mot-de-passe-oublie",
        <PublicOnly>
          <ForgotPasswordPage />
        </PublicOnly>,
      )}
      {route(
        "/reinitialiser-mot-de-passe",
        <PublicOnly>
          <ResetPasswordPage />
        </PublicOnly>,
      )}

      {/* Espace gérant (ADMIN) */}
      <Route
        element={
          <RequireAuth>
            <RequireRole roles={["ADMIN"]}>
              <Shell variant="admin" />
            </RequireRole>
          </RequireAuth>
        }
      >
        {route("/admin", <DashboardPage />)}
        {route("/admin/produits", <ProductsPage />)}
        {route("/admin/produits/nouveau", <ProductFormPage />)}
        {route("/admin/produits/:id", <ProductDetailPage />)}
        {route("/admin/produits/:id/modifier", <ProductFormPage />)}
        {route("/admin/categories", <CategoriesPage />)}
        {route("/admin/unites", <UnitsPage />)}
        {route("/admin/depots", <DepotsPage />)}
        {route("/admin/fournisseurs", <SuppliersPage />)}
        {route("/admin/clients", <CustomersPage />)}
        {route("/admin/devis", <QuotesPage />)}
        {route("/admin/commandes", <PurchaseOrdersPage />)}
        {route("/admin/receptions", <ReceiptsPage />)}
        {route("/admin/inventaire", <InventoryPage />)}
        {route("/admin/mouvements", <MovementsPage />)}
        {route("/admin/ventes", <SalesPage />)}
        {route("/admin/ventes/:id", <SaleDetailPage />)}
        {route("/admin/sessions-caisse", <CashSessionsPage />)}
        {route("/admin/factures", <InvoicesPage />)}
        {route("/admin/promotions", <PromotionsPage />)}
        {route("/admin/equipe", <VendorsPage />)}
        {route("/admin/rapports", <ReportsPage />)}
        {route("/admin/notifications", <NotificationsPage />)}
        {route("/admin/parametres", <SettingsPage />)}
        {route("/admin/abonnement", <SubscriptionPage />)}
        {route("/admin/journal", <AuditPage />)}
        {route("/admin/caisse", <PosPage />)}
      </Route>

      {/* Espace caisse (VENDEUR, et ADMIN en mode comptoir) */}
      <Route
        element={
          <RequireAuth>
            <RequireRole roles={["VENDEUR", "ADMIN"]}>
              <Shell variant="vendor" />
            </RequireRole>
          </RequireAuth>
        }
      >
        {route("/caisse", <PosPage />)}
        {route("/caisse/session", <CashSessionPage />)}
        {route("/caisse/mes-ventes", <PaymentsPage />)}
        {route("/caisse/stock", <StockPage />)}
        {route("/caisse/cloture", <ZReportPage />)}
        {route("/caisse/file", <SyncQueuePage />)}
      </Route>

      {/* Console éditeur (SUPER_ADMIN) */}
      <Route
        element={
          <RequireAuth>
            <RequireRole roles={["SUPER_ADMIN"]}>
              <Shell variant="sa" />
            </RequireRole>
          </RequireAuth>
        }
      >
        {route("/sa", <SaDashboardPage />)}
        {route("/sa/tenants", <SaTenantsPage />)}
        {route("/sa/tenants/:id", <SaTenantDetailPage />)}
        {route("/sa/licences", <SaLicensesPage />)}
        {route("/sa/plans", <SaPlansPage />)}
        {route("/sa/configs", <SaConfigsPage />)}
        {route("/sa/supervision", <SaSupervisionPage />)}
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
