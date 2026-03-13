import { useEffect, useState } from 'react';
import AdminLayout from '@/layouts/AdminLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import type { Supplier } from '@/types';

export default function AdminSuppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSuppliers();
  }, [user]);

  async function loadSuppliers() {
    if (!user?.depotId) return;
    const allSuppliers = await db.suppliers.where('depotId').equals(user.depotId).toArray();
    setSuppliers(allSuppliers);
  }

  const filteredSuppliers = suppliers.filter(supplier =>
    supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    supplier.phone.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestion des fournisseurs</h1>
            <p className="text-gray-600 mt-2">Gérer vos fournisseurs et commandes</p>
          </div>
          <Button className="bg-green-600 hover:bg-green-700">
            <Plus className="h-4 w-4 mr-2" />
            Nouveau fournisseur
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Rechercher un fournisseur..."
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
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Nom</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Téléphone</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Adresse</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{supplier.name}</td>
                      <td className="py-3 px-4 text-gray-600">{supplier.phone}</td>
                      <td className="py-3 px-4 text-gray-600">{supplier.email || '-'}</td>
                      <td className="py-3 px-4 text-gray-600">{supplier.address || '-'}</td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm">Modifier</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSuppliers.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Aucun fournisseur trouvé
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}