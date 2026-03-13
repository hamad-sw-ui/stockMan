import { useState, useEffect } from 'react';
import { useStockStore } from '@/store/useStockStore';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  PlusCircle, 
  Scaling, 
  ArrowRight, 
  AlertCircle, 
  Info,
  Trash2,
  Edit2
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Unit } from '@/types';

export default function UnitsConfig() {
  const { units, fetchStockData, addUnit, isLoading } = useStockStore();
  const { tenant } = useAuth();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUnit, setNewUnit] = useState<Partial<Unit>>({
    name: '',
    symbol: '',
    baseValue: 1,
    isBase: false
  });

  useEffect(() => {
    if (tenant) fetchStockData(tenant.id);
  }, [tenant]);

  const handleAddUnit = async () => {
    if (!tenant) return;
    if (!newUnit.name || !newUnit.symbol) {
      toast.error("Veuillez remplir tous les champs obligatoires");
      return;
    }

    try {
      const unit: Unit = {
        id: `unit-${Date.now()}`,
        tenantId: tenant.id,
        name: newUnit.name as string,
        symbol: newUnit.symbol as string,
        baseValue: newUnit.baseValue || 1,
        isBase: newUnit.isBase || false
      };

      await addUnit(unit);
      toast.success("Unité ajoutée avec succès");
      setIsDialogOpen(false);
      setNewUnit({ name: '', symbol: '', baseValue: 1, isBase: false });
    } catch (error) {
      toast.error("Erreur lors de l'ajout");
    }
  };

  const baseUnit = units.find(u => u.isBase) || units[0];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Scaling className="h-8 w-8 text-emerald-600" />
            Unités de Mesure
          </h1>
          <p className="text-muted-foreground mt-1">
            Définissez comment vous comptez vos stocks (Pièce, Carton, Palette...).
          </p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 shadow-md">
              <PlusCircle className="mr-2 h-4 w-4" /> Nouvelle Unité
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter une Unité</DialogTitle>
              <DialogDescription>
                Créez une unité pour vos produits et définissez son ratio de conversion.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom complet</Label>
                  <Input 
                    id="name" 
                    placeholder="Ex: Carton de 24" 
                    value={newUnit.name}
                    onChange={(e) => setNewUnit({...newUnit, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbole / Abréviation</Label>
                  <Input 
                    id="symbol" 
                    placeholder="Ex: Ctn24" 
                    value={newUnit.symbol}
                    onChange={(e) => setNewUnit({...newUnit, symbol: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseValue">Coefficient de conversion</Label>
                <div className="flex items-center gap-3">
                  <Input 
                    id="baseValue" 
                    type="number" 
                    min="1"
                    value={newUnit.baseValue}
                    onChange={(e) => setNewUnit({...newUnit, baseValue: parseInt(e.target.value)})}
                  />
                  <span className="text-sm text-gray-500 whitespace-nowrap">
                    = {newUnit.baseValue} {baseUnit?.symbol || 'unité(s)'} de base
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Indiquez combien d'unités de base contient cet ensemble.
                </p>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-50">
                <div className="space-y-0.5">
                  <Label>Unité de base la plus petite</Label>
                  <p className="text-xs text-gray-500">Activer si c'est l'unité de mesure minimale (ex: Pièce).</p>
                </div>
                <Switch 
                  checked={newUnit.isBase}
                  onCheckedChange={(val) => setNewUnit({...newUnit, isBase: val, baseValue: val ? 1 : newUnit.baseValue})}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
              <Button className="bg-emerald-600" onClick={handleAddUnit}>Enregistrer l'unité</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Alerte Explicative */}
      <Card className="bg-blue-50 border-blue-100 shadow-sm">
        <CardContent className="p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-bold mb-1">Comment fonctionnent les conversions ?</p>
            <p>Le système utilise une <strong>unité de base</strong> (valeur = 1) pour les calculs de stock. Les autres unités sont des multiples. 
            Exemple : 1 Carton (Coeff: 24) sera automatiquement converti en 24 Pièces lors de la vente au détail.</p>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-xl bg-white shadow-xl overflow-hidden">
        <Table>
          <TableHeader className="bg-gray-50 border-b">
            <TableRow>
              <TableHead className="font-bold">Unité</TableHead>
              <TableHead className="font-bold">Symbole</TableHead>
              <TableHead className="font-bold">Ratio de Conversion</TableHead>
              <TableHead className="font-bold">Visualisation</TableHead>
              <TableHead className="text-right font-bold">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-gray-500">
                  Aucune unité configurée. Utilisez le bouton "Nouvelle Unité".
                </TableCell>
              </TableRow>
            ) : (
              units.map((unit) => (
                <TableRow key={unit.id} className="hover:bg-gray-50/50 transition-colors">
                  <TableCell className="font-bold text-gray-900">
                    <div className="flex items-center gap-2">
                      {unit.name}
                      {unit.isBase && <Badge className="bg-blue-100 text-blue-700 border-none text-[10px]">BASE</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-emerald-700 border-emerald-200">
                      {unit.symbol}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-700">x{unit.baseValue}</span>
                      <span className="text-gray-400">par rapport à la base</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border w-fit">
                      <span className="text-xs font-bold text-gray-600">1 {unit.symbol}</span>
                      <ArrowRight className="h-3 w-3 text-gray-400" />
                      <span className="text-xs font-bold text-emerald-600">{unit.baseValue} {baseUnit?.symbol}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {units.length > 0 && !units.some(u => u.isBase) && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
          <AlertCircle className="h-4 w-4" />
          Attention : Aucune unité n'est définie comme unité de base. Les conversions risquent d'être incorrectes.
        </div>
      )}
    </div>
  );
}
