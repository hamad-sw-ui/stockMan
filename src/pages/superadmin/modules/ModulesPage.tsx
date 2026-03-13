import { useModuleStore } from '@/store/useModuleStore';
import { useAuth } from '@/contexts/AuthContext';
import { getAvailablePlugins } from '@/lib/plugins';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useEffect } from 'react';

const ModulesPage = () => {
  const { activeModules, fetchModules, toggleModule, isLoading } = useModuleStore();
  const { tenant } = useAuth();
  const availablePlugins = getAvailablePlugins();

  useEffect(() => {
    if (tenant) fetchModules(tenant.id);
  }, [tenant]);

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Catalogue de Modules</h1>
        <p className="text-muted-foreground">Activez ou désactivez les fonctionnalités avancées pour {tenant?.name}.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {availablePlugins.map((plugin) => (
          <Card key={plugin.id} className={activeModules.includes(plugin.id) ? "border-emerald-500 shadow-md" : ""}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle>{plugin.name}</CardTitle>
                <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">v{plugin.version}</span>
              </div>
              <CardDescription>{plugin.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground">
                <strong>Permissions requises :</strong>
                <ul className="list-disc list-inside mt-1">
                  {plugin.permissions.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            </CardContent>
            <CardFooter className="border-t pt-4 flex items-center justify-between">
              <Label htmlFor={`module-${plugin.id}`} className="cursor-pointer">Statut : {activeModules.includes(plugin.id) ? "Activé" : "Désactivé"}</Label>
              <Switch 
                id={`module-${plugin.id}`} 
                checked={activeModules.includes(plugin.id)}
                onCheckedChange={() => tenant && toggleModule(tenant.id, plugin.id)}
                disabled={isLoading}
              />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ModulesPage;
