import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/store/useTenantStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Palette, Upload, CheckCircle2, RefreshCw } from 'lucide-react';

export default function BrandingSettings() {
  const { tenant } = useAuth();
  const { updateTenant } = useTenantStore();
  
  const [name, setName] = useState(tenant?.name || '');
  const [logo, setLogo] = useState(tenant?.logo || '');
  const [primaryColor, setPrimaryColor] = useState(tenant?.primaryColor || '#10B981');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setLogo(tenant.logo || '');
      setPrimaryColor(tenant.primaryColor || '#10B981');
    }
  }, [tenant]);

  const handleSave = async () => {
    if (!tenant) return;
    
    setIsSaving(true);
    try {
      await updateTenant(tenant.id, {
        name,
        logo,
        primaryColor
      });
      
      // Mise à jour locale du localStorage pour la session actuelle
      const updatedTenant = { ...tenant, name, logo, primaryColor };
      localStorage.setItem('depot_auth_tenant', JSON.stringify(updatedTenant));
      
      toast.success('Paramètres de thémage mis à jour avec succès');
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  const PRESET_COLORS = [
    '#10B981', // Emerald (Default)
    '#3B82F6', // Blue
    '#6366F1', // Indigo
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#F43F5E', // Rose
    '#F59E0B', // Amber
    '#0EA5E9', // Sky
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personnalisation</h1>
          <p className="text-muted-foreground">Adaptez StockMan à l'image de votre entreprise.</p>
        </div>
        <Button 
          onClick={handleSave} 
          className="bg-emerald-600 hover:bg-emerald-700"
          disabled={isSaving}
        >
          {isSaving ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Enregistrer les modifications
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Paramètres Visuels */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Palette className="mr-2 h-5 w-5 text-emerald-600" />
              Identité Visuelle
            </CardTitle>
            <CardDescription>Configurez votre logo et votre nom commercial.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name">Nom de l'organisation</Label>
              <Input 
                id="tenant-name" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Mon Dépôt SARL"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="logo-url">URL du Logo</Label>
              <div className="flex gap-2">
                <Input 
                  id="logo-url" 
                  value={logo} 
                  onChange={(e) => setLogo(e.target.value)}
                  placeholder="https://votre-site.com/logo.png"
                />
                <Button variant="outline" size="icon">
                  <Upload className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Utilisez une URL directe vers une image PNG ou SVG.</p>
            </div>

            <div className="mt-4 p-4 border rounded-lg bg-gray-50 flex items-center justify-center">
              {logo ? (
                <img src={logo} alt="Aperçu Logo" className="max-h-16" />
              ) : (
                <div className="h-16 w-16 bg-gray-200 rounded flex items-center justify-center text-gray-400">
                  Pas de logo
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Couleurs de Thème */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Palette className="mr-2 h-5 w-5 text-emerald-600" />
              Couleurs du Thème
            </CardTitle>
            <CardDescription>Choisissez la couleur principale de votre interface.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Couleur Primaire</Label>
              <div className="flex items-center gap-4">
                <div 
                  className="w-12 h-12 rounded-full border shadow-sm" 
                  style={{ backgroundColor: primaryColor }}
                />
                <Input 
                  type="text" 
                  value={primaryColor} 
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setPrimaryColor(color)}
                  className={`h-10 rounded-md border-2 transition-all ${
                    primaryColor === color ? 'border-gray-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="p-4 rounded-lg border bg-white space-y-3">
              <p className="text-sm font-medium text-gray-500 mb-1">Aperçu des composants :</p>
              <div className="flex flex-wrap gap-2">
                <Button style={{ backgroundColor: primaryColor }}>Bouton Primaire</Button>
                <div 
                  className="px-3 py-1 rounded-full text-white text-xs font-semibold"
                  style={{ backgroundColor: primaryColor }}
                >
                  Badge Statut
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
