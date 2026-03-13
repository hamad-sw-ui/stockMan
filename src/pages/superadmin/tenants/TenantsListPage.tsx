import { useTenantStore } from '@/store/useTenantStore';
import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const TenantsListPage = () => {
  const { tenants, isLoading, fetchTenants } = useTenantStore();

  useEffect(() => {
    fetchTenants();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Gestion des Clients SaaS</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tenants.map((tenant) => (
          <Card key={tenant.id}>
            <CardHeader>
              <CardTitle>{tenant.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-2">Sous-domaine : {tenant.subdomain || 'N/A'}</p>
              <Badge variant={tenant.isActive ? 'default' : 'destructive'}>
                {tenant.isActive ? 'Actif' : 'Inactif'}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default TenantsListPage;
