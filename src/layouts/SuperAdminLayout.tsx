import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  Store, 
  Users, 
  Settings, 
  FileText, 
  LogOut, 
  Menu, 
  X,
  ShieldCheck,
  CreditCard,
  Puzzle,
  Activity,
  Building2
} from 'lucide-react';

interface SuperAdminLayoutProps {
  children: ReactNode;
}

const menuItems = [
  { path: '/superadmin/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { path: '/superadmin/tenants', label: 'Organisations', icon: Building2 },
  { path: '/superadmin/licences', label: 'Abonnements', icon: CreditCard },
  { path: '/superadmin/modules', label: 'Catalogue Modules', icon: Puzzle },
  { path: '/superadmin/logs', label: 'Audit & Logs', icon: Activity },
  { path: '/superadmin/users', label: 'Utilisateurs', icon: Users },
  { path: '/superadmin/settings', label: 'Système', icon: Settings },
];

export default function SuperAdminLayout({ children }: SuperAdminLayoutProps) {
  const { user, tenant, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const primaryColor = '#2563eb'; // Bleu Super Admin par défaut

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg rotate-3">
            <ShieldCheck className="text-white h-5 w-5" />
          </div>
          <span className="font-bold text-gray-900 tracking-tight text-sm">STOCKMAN PLATFORM</span>
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
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
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
          <div className="flex items-center gap-3 px-6 py-6 border-b border-gray-200">
            <div className="bg-blue-600 p-2 rounded-xl shadow-lg rotate-3 border-2 border-white">
              <ShieldCheck className="text-white h-6 w-6" />
            </div>
            <div>
              <h1 className="font-black text-gray-900 leading-none text-lg">StockMan</h1>
              <p className="text-[10px] text-blue-600 font-bold uppercase tracking-tighter mt-1">Super Admin Panel</p>
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
                      ? 'bg-blue-50 text-blue-700 font-bold shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className="text-sm">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="px-4 py-4 border-t border-gray-200 bg-gray-50/50">
            <div className="flex items-center gap-3 px-4 py-2 mb-2">
              <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-black shadow-inner">
                {user?.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 truncate uppercase">{user?.name}</p>
                <p className="text-[10px] text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 text-xs font-bold"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              QUITTER LA SESSION
            </Button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64">
          <div className="px-4 py-6 lg:px-10 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}