import { useEffect, useState } from 'react';
import SuperAdminLayout from '@/layouts/SuperAdminLayout';
import KPICard from '@/components/KPICard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Store, Users, TrendingUp, AlertCircle } from 'lucide-react';
import { db } from '@/lib/db';

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState({
    totalDepots: 0,
    activeDepots: 0,
    totalUsers: 0,
    totalSales: 0
  });

  useEffect(() => {
    async function loadStats() {
      const depots = await db.depots.toArray();
      const users = await db.users.toArray();
      const sales = await db.sales.toArray();

      const totalSalesAmount = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);

      setStats({
        totalDepots: depots.length,
        activeDepots: depots.filter(d => d.isActive).length,
        totalUsers: users.length,
        totalSales: totalSalesAmount
      });
    }

    loadStats();
  }, []);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tableau de bord Super Admin</h1>
          <p className="text-gray-600 mt-2">Vue d'ensemble de tous les dépôts</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard
            title="Dépôts actifs"
            value={`${stats.activeDepots}/${stats.totalDepots}`}
            icon={Store}
          />
          <KPICard
            title="Utilisateurs totaux"
            value={stats.totalUsers}
            icon={Users}
          />
          <KPICard
            title="Ventes totales"
            value={`${stats.totalSales.toLocaleString()} FCFA`}
            icon={TrendingUp}
          />
          <KPICard
            title="Alertes"
            value="0"
            icon={AlertCircle}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Dépôts récents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                Liste des dépôts récemment créés
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activité récente</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-gray-500">
                Journal des actions importantes
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </SuperAdminLayout>
  );
}