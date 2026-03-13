import { useEffect, useState } from 'react';
import VendorLayout from '@/layouts/VendorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Send, TrendingUp, ShoppingCart, Package } from 'lucide-react';
import type { Sale } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function VendorDayClose() {
  const { user } = useAuth();
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [stats, setStats] = useState({
    totalAmount: 0,
    totalSales: 0,
    totalItems: 0
  });

  useEffect(() => {
    loadTodaySales();
  }, [user]);

  async function loadTodaySales() {
    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sales = await db.sales
      .where('vendorId')
      .equals(user.id)
      .and(sale => new Date(sale.createdAt) >= today)
      .toArray();

    const totalAmount = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalItems = sales.reduce((sum, sale) => 
      sum + sale.items.reduce((s, item) => s + item.quantity, 0), 0
    );

    setTodaySales(sales);
    setStats({
      totalAmount,
      totalSales: sales.length,
      totalItems
    });
  }

  const handleSendReport = () => {
    toast.success('Rapport envoyé au propriétaire avec succès!');
  };

  return (
    <VendorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clôture de journée</h1>
          <p className="text-gray-600 mt-2">Rapport quotidien - {format(new Date(), 'dd MMMM yyyy', { locale: fr })}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-gradient-to-br from-green-50 to-green-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Ventes totales</p>
                  <p className="text-2xl font-bold text-green-600 mt-2">
                    {stats.totalAmount.toLocaleString()} FCFA
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-green-200 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-green-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-blue-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Nombre de ventes</p>
                  <p className="text-2xl font-bold text-blue-600 mt-2">{stats.totalSales}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-blue-200 flex items-center justify-center">
                  <ShoppingCart className="h-6 w-6 text-blue-700" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Articles vendus</p>
                  <p className="text-2xl font-bold text-purple-600 mt-2">{stats.totalItems}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-purple-200 flex items-center justify-center">
                  <Package className="h-6 w-6 text-purple-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Détail des ventes du jour</CardTitle>
          </CardHeader>
          <CardContent>
            {todaySales.length > 0 ? (
              <div className="space-y-3">
                {todaySales.map((sale) => (
                  <div key={sale.id} className="p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900">
                          {format(new Date(sale.createdAt), 'HH:mm', { locale: fr })}
                        </p>
                        <p className="text-sm text-gray-600">{sale.items.length} article(s)</p>
                      </div>
                      <p className="text-lg font-bold text-green-600">
                        {sale.totalAmount.toLocaleString()} FCFA
                      </p>
                    </div>
                    <div className="text-sm text-gray-600">
                      {sale.items.map((item, idx) => (
                        <span key={idx}>
                          {item.productName} x{item.quantity}
                          {idx < sale.items.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Aucune vente aujourd'hui
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button 
            className="bg-green-600 hover:bg-green-700"
            onClick={handleSendReport}
            disabled={todaySales.length === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            Envoyer au propriétaire
          </Button>
        </div>
      </div>
    </VendorLayout>
  );
}