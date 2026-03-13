import SuperAdminLayout from '@/layouts/SuperAdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function SuperAdminReports() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Rapports consolidés</h1>
            <p className="text-gray-600 mt-2">Vue d'ensemble de tous les dépôts</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Ventes totales</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">77,500 FCFA</p>
              <p className="text-sm text-gray-500 mt-2">Tous les dépôts confondus</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Produits en stock</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-600">381</p>
              <p className="text-sm text-gray-500 mt-2">Unités totales</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alertes actives</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-red-600">2</p>
              <p className="text-sm text-gray-500 mt-2">Stock faible et produits expirés</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Graphique des ventes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-gray-500">
              Graphique des ventes par dépôt (à implémenter avec Recharts)
            </div>
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
}