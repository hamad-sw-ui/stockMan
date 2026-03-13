import { useEffect, useState } from 'react';
import AdminLayout from '@/layouts/AdminLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import PaymentMethodIcon from '@/components/PaymentMethodIcon';
import EmptyState from '@/components/EmptyState';
import { Search } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import type { Sale } from '@/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function AdminSales() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSales();
  }, [user]);

  async function loadSales() {
    if (!user?.depotId) return;
    const allSales = await db.sales
      .where('depotId')
      .equals(user.depotId)
      .reverse()
      .toArray();
    setSales(allSales);
  }

  const filteredSales = sales.filter(sale =>
    sale.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sale.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Ventes et caisse</h1>
          <p className="text-gray-600 mt-2">Historique des ventes du dépôt</p>
        </div>

        {sales.length === 0 ? (
          <EmptyState
            title="Aucune vente"
            description="Les ventes effectuées apparaîtront ici"
            imageSrc="https://mgx-backend-cdn.metadl.com/generate/images/916314/2026-01-17/d01d549c-13fe-49e1-86ff-ee9e47499bea.png"
          />
        ) : (
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Vendeur</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Articles</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Montant</th>
                      <th className="text-left py-3 px-4 font-semibold text-gray-700">Paiement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSales.map((sale) => (
                      <tr key={sale.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-600">
                          {format(new Date(sale.createdAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                        </td>
                        <td className="py-3 px-4 font-medium">{sale.vendorName}</td>
                        <td className="py-3 px-4 text-gray-600">
                          <div className="text-sm">
                            {sale.items.map((item, idx) => (
                              <div key={idx}>
                                {item.productName} x{item.quantity}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-green-600">
                          {sale.totalAmount.toLocaleString()} FCFA
                        </td>
                        <td className="py-3 px-4">
                          <PaymentMethodIcon method={sale.paymentMethod} showLabel />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredSales.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    Aucune vente trouvée
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}