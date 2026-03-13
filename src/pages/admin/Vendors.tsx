import { useEffect, useState } from 'react';
import AdminLayout from '@/layouts/AdminLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import { Plus, Search } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@/types';

export default function AdminVendors() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadVendors();
  }, [user]);

  async function loadVendors() {
    if (!user?.depotId) return;
    const allVendors = await db.users
      .where('depotId')
      .equals(user.depotId)
      .and(u => u.role === 'VENDEUR')
      .toArray();
    setVendors(allVendors);
  }

  const filteredVendors = vendors.filter(vendor =>
    vendor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vendor.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestion des vendeurs</h1>
            <p className="text-gray-600 mt-2">Gérer l'équipe de vendeurs</p>
          </div>
          <Button className="bg-green-600 hover:bg-green-700">
            <Plus className="h-4 w-4 mr-2" />
            Nouveau vendeur
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Rechercher un vendeur..."
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
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Statut</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.map((vendor) => (
                    <tr key={vendor.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{vendor.name}</td>
                      <td className="py-3 px-4 text-gray-600">{vendor.email}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={vendor.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm">Modifier</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredVendors.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Aucun vendeur trouvé
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}