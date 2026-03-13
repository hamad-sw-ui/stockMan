import { useEffect, useState } from 'react';
import SuperAdminLayout from '@/layouts/SuperAdminLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import { Plus, Search } from 'lucide-react';
import { db } from '@/lib/db';
import type { User } from '@/types';

export default function SuperAdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    const allUsers = await db.users.toArray();
    setUsers(allUsers);
  }

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: User['role']) => {
    const config = {
      SUPER_ADMIN: { label: 'Super Admin', className: 'bg-purple-100 text-purple-800' },
      ADMIN: { label: 'Admin', className: 'bg-blue-100 text-blue-800' },
      VENDEUR: { label: 'Vendeur', className: 'bg-green-100 text-green-800' }
    };
    return config[role];
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestion des utilisateurs</h1>
            <p className="text-gray-600 mt-2">Gérer tous les comptes utilisateurs</p>
          </div>
          <Button className="bg-green-600 hover:bg-green-700">
            <Plus className="h-4 w-4 mr-2" />
            Nouvel utilisateur
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Rechercher un utilisateur..."
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
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Rôle</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Statut</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const roleBadge = getRoleBadge(user.role);
                    return (
                      <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 font-medium">{user.name}</td>
                        <td className="py-3 px-4 text-gray-600">{user.email}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleBadge.className}`}>
                            {roleBadge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={user.isActive ? 'active' : 'inactive'} />
                        </td>
                        <td className="py-3 px-4">
                          <Button variant="ghost" size="sm">Modifier</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredUsers.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Aucun utilisateur trouvé
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}