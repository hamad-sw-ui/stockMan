import { useEffect, useState } from 'react';
import VendorLayout from '@/layouts/VendorLayout';
import KPICard from '@/components/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Package, AlertTriangle, Calendar } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import StatusBadge from '@/components/StatusBadge';
import type { Product } from '@/types';

export default function VendorDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    mySalesToday: 0,
    lowStockCount: 0,
    expiredCount: 0,
    availableProducts: 0
  });
  const [alerts, setAlerts] = useState<Product[]>([]);

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

    // Charger mes ventes du jour
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mySales = await db.sales
      .where('vendorId')
      .equals(user.id)
      .and(sale => new Date(sale.createdAt) >= today)
      .toArray();

    const myTodayTotal = mySales.reduce((sum, sale) => sum + sale.totalAmount, 0);

    setStats({
      mySalesToday: myTodayTotal,
      lowStockCount: lowStock.length,
      expiredCount: expired.length,
      availableProducts: products.filter(p => p.quantity > 0).length
    });

    // Alertes combinées
    setAlerts([...lowStock, ...expired].slice(0, 5));
  }

  return (
    <VendorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-gray-600 mt-2">Bienvenue, {user?.name}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard
            title="Mes ventes du jour"
            value={`${stats.mySalesToday.toLocaleString()} FCFA`}
            icon={TrendingUp}
            className="bg-gradient-to-br from-green-50 to-green-100"
          />
          <KPICard
            title="Produits disponibles"
            value={stats.availableProducts}
            icon={Package}
            className="bg-gradient-to-br from-blue-50 to-blue-100"
          />
          <KPICard
            title="Stock faible"
            value={stats.lowStockCount}
            icon={AlertTriangle}
            className="bg-gradient-to-br from-orange-50 to-orange-100"
          />
          <KPICard
            title="Produits expirés"
            value={stats.expiredCount}
            icon={Calendar}
            className="bg-gradient-to-br from-red-50 to-red-100"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Alertes importantes</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((product) => {
                  const isExpired = product.expirationDate && new Date(product.expirationDate) < new Date();
                  const isLowStock = product.quantity <= product.minStockLevel;
                  
                  return (
                    <div key={product.id} className="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 rounded">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-red-900">{product.name}</p>
                        <p className="text-xs text-red-700 mt-1">
                          {isExpired ? 'Produit expiré' : `Stock faible: ${product.quantity} unités`}
                        </p>
                        <StatusBadge status={isExpired ? 'expired' : 'low_stock'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Aucune alerte
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </VendorLayout>
  );
}