import { useEffect, useState } from 'react';
import SuperAdminLayout from '@/layouts/SuperAdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import { Plus, Search } from 'lucide-react';
import { db } from '@/lib/db';
import type { Depot } from '@/types';

export default function SuperAdminDepots() {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadDepots();
  }, []);

  async function loadDepots() {
    const allDepots = await db.depots.toArray();
    setDepots(allDepots);
  }

  const filteredDepots = depots.filter(depot =>
    depot.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    depot.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestion des dépôts</h1>
            <p className="text-gray-600 mt-2">Gérer tous les dépôts de la plateforme</p>
          </div>
          <Button className="bg-green-600 hover:bg-green-700">
            <Plus className="h-4 w-4 mr-2" />
            Nouveau dépôt
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Rechercher un dépôt..."
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
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Adresse</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Téléphone</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Statut</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepots.map((depot) => (
                    <tr key={depot.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{depot.name}</td>
                      <td className="py-3 px-4 text-gray-600">{depot.address}</td>
                      <td className="py-3 px-4 text-gray-600">{depot.phone}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={depot.isActive ? 'active' : 'inactive'} />
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm">Modifier</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredDepots.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Aucun dépôt trouvé
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}