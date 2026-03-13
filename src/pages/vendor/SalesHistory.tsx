import { useEffect, useState } from 'react';
import VendorLayout from '@/layouts/VendorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import PaymentMethodIcon from '@/components/PaymentMethodIcon';
import EmptyState from '@/components/EmptyState';
import { Search } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import type { Sale } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function VendorSalesHistory() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSales();
  }, [user]);

  async function loadSales() {
    if (!user) return;
    const mySales = await db.sales
      .where('vendorId')
      .equals(user.id)
      .reverse()
      .toArray();
    setSales(mySales);
  }

  const filteredSales = sales.filter(sale =>
    sale.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalAmount = filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const totalItems = filteredSales.reduce((sum, sale) => sum + sale.items.reduce((s, item) => s + item.quantity, 0), 0);

  return (
    <VendorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Historique des ventes</h1>
          <p className="text-gray-600 mt-2">Mes ventes enregistrées</p>
        </div>

        {sales.length === 0 ? (
          <EmptyState
            title="Aucune vente"
            description="Vos ventes apparaîtront ici"
            imageSrc="https://mgx-backend-cdn.metadl.com/generate/images/916314/2026-01-17/d01d549c-13fe-49e1-86ff-ee9e47499bea.png"
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-gray-600">Total des ventes</p>
                  <p className="text-2xl font-bold text-green-600 mt-2">
                    {totalAmount.toLocaleString()} FCFA
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-gray-600">Nombre de ventes</p>
                  <p className="text-2xl font-bold text-blue-600 mt-2">{filteredSales.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-gray-600">Articles vendus</p>
                  <p className="text-2xl font-bold text-purple-600 mt-2">{totalItems}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Rechercher une vente..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {filteredSales.map((sale) => (
                    <div key={sale.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-sm text-gray-600">
                            {format(new Date(sale.createdAt), 'dd MMMM yyyy à HH:mm', { locale: fr })}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">ID: {sale.id}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-green-600">
                            {sale.totalAmount.toLocaleString()} FCFA
                          </p>
                          <PaymentMethodIcon method={sale.paymentMethod} showLabel size="sm" />
                        </div>
                      </div>
                      <div className="border-t pt-3">
                        <p className="text-sm font-medium text-gray-700 mb-2">Articles:</p>
                        <div className="space-y-1">
                          {sale.items.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">
                                {item.productName} x{item.quantity}
                              </span>
                              <span className="font-medium text-gray-900">
                                {item.totalPrice.toLocaleString()} FCFA
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {filteredSales.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    Aucune vente trouvée
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </VendorLayout>
  );
}