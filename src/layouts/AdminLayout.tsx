import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  Truck, 
  FileText, 
  LogOut, 
  Menu, 
  X,
  Palette
} from 'lucide-react';

interface AdminLayoutProps {
  children: ReactNode;
}

const menuItems = [
  { path: '/admin/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { path: '/admin/stock', label: 'Stock', icon: Package },
  { path: '/admin/sales', label: 'Ventes', icon: ShoppingCart },
  { path: '/admin/vendors', label: 'Vendeurs', icon: Users },
  { path: '/admin/suppliers', label: 'Fournisseurs', icon: Truck },
  { path: '/admin/reports', label: 'Rapports', icon: FileText },
  { path: '/admin/branding', label: 'Personnalisation', icon: Palette },
];

export default function AdminLayout({ children }: AdminLayoutProps) {
  const { user, tenant, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const primaryColor = tenant?.primaryColor || '#10B981';
  const logo = tenant?.logo || 'https://mgx-backend-cdn.metadl.com/generate/images/916314/2026-01-17/99e6470a-bfb2-4304-8436-d9da1ac30c0c.png';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img 
            src={logo} 
            alt="Logo" 
            className="h-8 w-auto object-contain"
          />
          <span className="font-semibold text-gray-900 truncate max-w-[150px]">{tenant?.name || 'Admin'}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-white border-b border-gray-200">
          <nav className="px-4 py-2 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  style={isActive ? { backgroundColor: `${primaryColor}20`, color: primaryColor } : {}}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <div className="flex">
        {/* Sidebar - Desktop */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-gray-200">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200">
            <img 
              src={logo} 
              alt="Logo" 
              className="h-10 w-auto object-contain"
            />
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 truncate">{tenant?.name || 'Gestion Dépôts'}</h1>
              <p className="text-xs text-gray-600">Administrateur</p>
            </div>
          </div>

          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  style={isActive ? { backgroundColor: `${primaryColor}20`, color: primaryColor } : {}}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center gap-3 px-4 py-2 mb-2">
              <div 
                className="h-10 w-10 rounded-full flex items-center justify-center text-white font-semibold"
                style={{ backgroundColor: primaryColor }}
              >
                {user?.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                <p className="text-xs text-gray-600 truncate">{user?.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64">
          <div className="px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}