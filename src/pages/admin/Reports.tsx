import AdminLayout from '@/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function AdminReports() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Rapports</h1>
            <p className="text-gray-600 mt-2">Rapports détaillés de votre dépôt</p>
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
              <CardTitle>Ventes du mois</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">77,500 FCFA</p>
              <p className="text-sm text-gray-500 mt-2">2 ventes enregistrées</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bénéfice net</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-600">15,500 FCFA</p>
              <p className="text-sm text-gray-500 mt-2">Marge moyenne: 25%</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Produits vendus</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-purple-600">17</p>
              <p className="text-sm text-gray-500 mt-2">Unités ce mois</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Évolution des ventes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center text-gray-500">
              Graphique des ventes (à implémenter avec Recharts)
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Produits les plus vendus</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">Riz 50kg</span>
                <span className="text-green-600 font-bold">2 unités</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">Huile végétale 5L</span>
                <span className="text-green-600 font-bold">5 unités</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">Lait concentré</span>
                <span className="text-green-600 font-bold">10 unités</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}