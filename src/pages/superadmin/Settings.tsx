import SuperAdminLayout from '@/layouts/SuperAdminLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export default function SuperAdminSettings() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Paramètres système</h1>
          <p className="text-gray-600 mt-2">Configuration globale de la plateforme</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Devise</CardTitle>
              <CardDescription>Configuration de la devise par défaut</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Devise principale</Label>
                <Input value="FCFA" disabled />
              </div>
              <div className="space-y-2">
                <Label>Symbole</Label>
                <Input value="FCFA" disabled />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mobile Money</CardTitle>
              <CardDescription>Configuration des services de paiement mobile</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>MTN Mobile Money</Label>
                  <p className="text-sm text-gray-500">Activer MTN MoMo</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Orange Money</Label>
                  <p className="text-sm text-gray-500">Activer Orange Money</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock</CardTitle>
              <CardDescription>Paramètres de gestion du stock</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Seuil de stock faible par défaut</Label>
                <Input type="number" defaultValue="10" />
              </div>
              <div className="space-y-2">
                <Label>Jours avant expiration (alerte)</Label>
                <Input type="number" defaultValue="30" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Catégories de produits</CardTitle>
              <CardDescription>Types de produits standards</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {['Céréales', 'Huiles', 'Sucres', 'Produits laitiers', 'Conserves', 'Boissons'].map((cat) => (
                    <span key={cat} className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                      {cat}
                    </span>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-4">
                  Gérer les catégories
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button className="bg-green-600 hover:bg-green-700">
            Enregistrer les modifications
          </Button>
        </div>
      </div>
    </SuperAdminLayout>
  );
}