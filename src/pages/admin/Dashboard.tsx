import { useEffect, useState } from 'react';
import AdminLayout from '@/layouts/AdminLayout';
import KPICard from '@/components/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Package, AlertTriangle, Calendar, Wallet } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import StatusBadge from '@/components/StatusBadge';
import { format, subDays, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend 
} from 'recharts';

export default function AdminDashboard() {
  const { user, tenant } = useAuth();
  const [stats, setStats] = useState({
    todaySales: 0,
    lowStockCount: 0,
    expiredCount: 0,
    totalProducts: 0
  });
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [paymentData, setPaymentData] = useState<any[]>([]);

  const primaryColor = tenant?.primaryColor || '#10B981';

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  async function loadDashboardData() {
    if (!user?.depotId) return;

    // Charger les produits du dépôt
    const products = await db.products.where('depotId').equals(user.depotId).toArray();
    
    // Compter les produits en stock faible
    const lowStock = products.filter(p => p.quantity <= p.minStockLevel);
    
    // Compter les produits expirés
    const now = new Date();
    const expired = products.filter(p => p.expirationDate && new Date(p.expirationDate) < now);

    // Charger les ventes des 7 derniers jours
    const sevenDaysAgo = subDays(new Date(), 7);
    const allRecentSales = await db.sales
      .where('depotId')
      .equals(user.depotId)
      .and(sale => new Date(sale.createdAt) >= sevenDaysAgo)
      .toArray();

    // Ventes du jour
    const today = new Date();
    const todaySales = allRecentSales.filter(sale => isSameDay(new Date(sale.createdAt), today));
    const todayTotal = todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0);

    // Préparer les données du graphique (7 jours)
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const daySales = allRecentSales.filter(sale => isSameDay(new Date(sale.createdAt), date));
      dailyData.push({
        name: format(date, 'EEE', { locale: fr }),
        total: daySales.reduce((sum, sale) => sum + sale.totalAmount, 0)
      });
    }
    setChartData(dailyData);

    // Préparer les données de paiement
    const payments = {
      'CASH': 0,
      'MTN_MOMO': 0,
      'ORANGE_MONEY': 0
    };
    allRecentSales.forEach(sale => {
      payments[sale.paymentMethod as keyof typeof payments] += sale.totalAmount;
    });

    setPaymentData([
      { name: 'Espèces', value: payments['CASH'], color: '#10B981' },
      { name: 'MTN MoMo', value: payments['MTN_MOMO'], color: '#FACC15' },
      { name: 'Orange Money', value: payments['ORANGE_MONEY'], color: '#F97316' },
    ]);

    setStats({
      todaySales: todayTotal,
      lowStockCount: lowStock.length,
      expiredCount: expired.length,
      totalProducts: products.length
    });

    setRecentSales(allRecentSales.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ).slice(0, 5));

    // Créer les alertes
    const alertsList = [
      ...lowStock.map(p => ({
        type: 'low_stock',
        message: `${p.name} - Stock faible (${p.quantity} unités)`,
        severity: 'high'
      })),
      ...expired.map(p => ({
        type: 'expired',
        message: `${p.name} - Produit expiré`,
        severity: 'high'
      }))
    ];

    setAlerts(alertsList.slice(0, 5));
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tableau de bord</h1>
            <p className="text-gray-600">Statistiques temps réel pour {tenant?.name}</p>
          </div>
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg border shadow-sm">
            <Calendar className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium">{format(new Date(), 'dd MMMM yyyy', { locale: fr })}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard
            title="Ventes du jour"
            value={`${stats.todaySales.toLocaleString()} FCFA`}
            icon={TrendingUp}
            className="border-l-4 border-l-emerald-500"
          />
          <KPICard
            title="Produits en stock"
            value={stats.totalProducts}
            icon={Package}
            className="border-l-4 border-l-blue-500"
          />
          <KPICard
            title="Stock faible"
            value={stats.lowStockCount}
            icon={AlertTriangle}
            className="border-l-4 border-l-orange-500"
          />
          <KPICard
            title="Produits expirés"
            value={stats.expiredCount}
            icon={Calendar}
            className="border-l-4 border-l-red-500"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Graphique des ventes */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                Tendances des ventes (7 derniers jours)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value: number) => [`${value.toLocaleString()} FCFA`, 'Ventes']}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="total" fill={primaryColor} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Répartition Paiements */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-500" />
                Modes de Paiement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {paymentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value.toLocaleString()} FCFA`} />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Ventes récentes</CardTitle>
            </CardHeader>
            <CardContent>
              {recentSales.length > 0 ? (
                <div className="space-y-3">
                  {recentSales.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{sale.vendorName}</p>
                        <p className="text-sm text-gray-600">
                          {format(new Date(sale.createdAt), 'dd MMM yyyy HH:mm', { locale: fr })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-green-600">{sale.totalAmount.toLocaleString()} FCFA</p>
                        <p className="text-xs text-gray-500 uppercase">{sale.paymentMethod.replace('_', ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Aucune vente récente
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alertes importantes</CardTitle>
            </CardHeader>
            <CardContent>
              {alerts.length > 0 ? (
                <div className="space-y-3">
                  {alerts.map((alert, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 rounded">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-red-900">{alert.message}</p>
                        <div className="mt-1">
                          <StatusBadge status={alert.type === 'low_stock' ? 'low_stock' : 'expired'} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Aucune alerte
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}