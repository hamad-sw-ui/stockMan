import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  History, 
  Package, 
  ClipboardCheck, 
  LogOut, 
  Menu, 
  X,
  Store,
  Wallet
} from 'lucide-react';

interface VendorLayoutProps {
  children: ReactNode;
}

const menuItems = [
  { path: '/vendor/dashboard', label: 'Ma Journée', icon: LayoutDashboard },
  { path: '/vendor/quick-sale', label: 'Caisse POS', icon: ShoppingCart },
  { path: '/vendor/sales-history', label: 'Ventes', icon: History },
  { path: '/vendor/stock', label: 'Inventaire', icon: Package },
  { path: '/vendor/day-close', label: 'Clôture', icon: ClipboardCheck },
];

export default function VendorLayout({ children }: VendorLayoutProps) {
  const { user, tenant, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const primaryColor = tenant?.primaryColor || '#10B981';
  const logo = tenant?.logo;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile Header */}
      <div className="lg:hidden bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt="Logo" className="h-8 w-auto object-contain" />
          ) : (
            <div className="p-1.5 rounded-lg text-white" style={{ backgroundColor: primaryColor }}>
              <Store className="h-5 w-5" />
            </div>
          )}
          <span className="font-bold text-gray-900 tracking-tight text-sm uppercase">{tenant?.name || 'Vendeur'}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-white border-b animate-in slide-in-from-top duration-300">
          <nav className="px-4 py-4 space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-4 px-4 py-4 rounded-xl font-bold transition-all"
                  style={isActive ? { backgroundColor: `${primaryColor}15`, color: primaryColor } : { color: '#4b5563' }}
                >
                  <Icon className="h-6 w-6" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <div className="flex">
        {/* Sidebar - Desktop */}
        <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:fixed lg:inset-y-0 bg-white border-r shadow-lg">
          <div className="px-8 py-10">
            <div className="flex flex-col items-center text-center space-y-4">
              {logo ? (
                <img src={logo} alt="Logo" className="h-16 w-auto object-contain" />
              ) : (
                <div className="p-4 rounded-2xl text-white shadow-xl rotate-3" style={{ backgroundColor: primaryColor }}>
                  <Store className="h-10 w-10" />
                </div>
              )}
              <div>
                <h1 className="font-black text-gray-900 text-xl tracking-tighter uppercase">{tenant?.name || 'StockMan'}</h1>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Session Vendeur Active</p>
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 px-6 space-y-2 overflow-y-auto">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all group hover:translate-x-1"
                  style={isActive ? { backgroundColor: primaryColor, color: 'white', shadow: '0 10px 15px -3px rgba(0,0,0,0.1)' } : { color: '#6b7280' }}
                >
                  <Icon className={`h-6 w-6 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}`} />
                  <span className="text-sm">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-6">
            <div className="bg-gray-50 rounded-3xl p-5 border border-gray-100">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg" style={{ backgroundColor: primaryColor }}>
                  {user?.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-900 truncate uppercase">{user?.name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{user?.email}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl font-bold text-xs"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                DÉCONNEXION
              </Button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-72 min-h-screen">
          <div className="p-4 md:p-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}