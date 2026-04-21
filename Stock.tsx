import { useEffect, useState } from 'react';
import AdminLayout from '@/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { 
  Plus, 
  Search, 
  AlertTriangle, 
  Layers, 
  Package, 
  Boxes, 
  ChevronDown, 
  ChevronRight,
  Calendar,
  Tag,
  Scale,
  Printer,
  Trash2,
  FileSpreadsheet,
  FileText,
  Download,
  ClipboardList,
  RefreshCw
} from 'lucide-react';
import { useStockStore } from '@/store/useStockStore';
import { useAuth } from '@/contexts/AuthContext';
import type { Product, ProductVariant, StockBatch } from '@/types';
import { format, isAfter, isBefore, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { labelService } from '@/lib/labelService';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ProductForm } from '@/components/forms/ProductForm';
import { StockAdjustmentForm } from '@/components/forms/StockAdjustmentForm';
import { exportToExcel, exportToPDF } from '@/lib/export';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AdminStock() {
  const { tenant } = useAuth();
  const { products, categories, units, isLoading, fetchStockData, addProduct, updateProduct, deleteProduct } = useStockStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  
  // États pour le formulaire
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAdjustDialogOpen, setIsAdjustDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | undefined>(undefined);

  useEffect(() => {
    if (tenant) fetchStockData(tenant.id);
  }, [tenant]);

  const handlePrintLabels = async (product: Product, variant?: ProductVariant) => {
    try {
      toast.info(`Génération des étiquettes pour ${variant ? variant.name : product.name}...`);
      await labelService.generateProductLabels(product, variant, tenant?.name, 24); // Par défaut 24 étiquettes (une planche A4)
      toast.success('Étiquettes générées avec succÃ¨s !');
    } catch (error) {
      console.error('Erreur impression étiquettes:', error);
      toast.error('Échec de la génération des étiquettes');
    }
  };
  
  const handleExport = (type: 'pdf' | 'excel') => {
    const data = products.map(p => ({
      Nom: p.name,
      Catégorie: getCategoryName(p.categoryId),
      'Prix Achat': p.purchasePrice,
      'Prix Vente': p.sellingPrice,
      Quantité: p.quantity,
      Unité: getUnitSymbol(p.unitId),
      Statut: getStockStatus(p)
    }));

    if (type === 'pdf') {
      exportToPDF(data, Object.keys(data[0]), `Inventaire_${tenant?.name}`);
    } else {
      exportToExcel(data, `Inventaire_${tenant?.name}`);
    }
    toast.success(`Export ${type.toUpperCase()} réussi !`);
  };

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockStatus = (product: Product) => {
    const now = new Date();
    
    // Vérifier les lots pour l'expiration
    const hasExpiredBatch = product.batches?.some(b => isBefore(new Date(b.expiryDate), now));
    if (hasExpiredBatch) return 'expired';

    const isNearExpiry = product.batches?.some(b => 
      isAfter(new Date(b.expiryDate), now) && 
      isBefore(new Date(b.expiryDate), addDays(now, 30))
    );
    if (isNearExpiry) return 'near_expiry';

    if (product.quantity <= product.minStockLevel) return 'low_stock';
    return 'active';
  };

  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || 'Sans Catégorie';
  const getUnitSymbol = (id: string) => units.find(u => u.id === id)?.symbol || 'Uté';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Boxes className="h-8 w-8 text-emerald-600" />
              Catalogue & Logistique
            </h1>
            <p className="text-muted-foreground">Gestion avancée des Unités, variantes et traÃ§abilité des lots.</p>
          </div>
          <div className="flex gap-2">
            <Link to="/admin/units">
              <Button variant="outline">
                <Scale className="h-4 w-4 mr-2" /> Unités
              </Button>
            </Link>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-2" /> Exporter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExport('pdf')}>
                  <FileText className="mr-2 h-4 w-4" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('excel')}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setEditingProduct(undefined)}
                >
                  <Plus className="h-4 w-4 mr-2" /> Nouveau Produit
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingProduct ? "Modifier le produit" : "Ajouter un produit"}</DialogTitle>
                </DialogHeader>
                {tenant && (
                  <ProductForm 
                    product={editingProduct} 
                    tenantId={tenant.id} 
                    onSuccess={() => {
                      setIsDialogOpen(false);
                      toast.success(editingProduct ? "Produit mis Ã  jour" : "Produit créé avec succÃ¨s");
                    }}
                    onCancel={() => setIsDialogOpen(false)}
                  />
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-white p-4 rounded-lg border shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Rechercher par nom, code-barres ou Catégorie..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-gray-200"
            />
          </div>
          <Button variant="ghost" size="icon" className="border">
            <Tag className="h-4 w-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-20">
            <RefreshCw className="h-10 w-10 animate-spin mx-auto text-emerald-600" />
            <p className="mt-4 text-gray-500 font-medium">Chargement du catalogue...</p>
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            title="Catalogue vide"
            description="Commencez Ã  structurer votre inventaire avec des Unités et des Catégories."
            imageSrc="https://mgx-backend-cdn.metadl.com/generate/images/916314/2026-01-17/a00a2e40-24b5-4436-bd3a-d6a6e0d768a7.png"
            action={{
              label: 'Créer mon premier produit',
              onClick: () => {
                setEditingProduct(undefined);
                setIsDialogOpen(true);
              }
            }}
          />
        ) : (
          <div className="grid gap-4">
            {filteredProducts.map((product) => (
              <Card key={product.id} className={`overflow-hidden transition-all ${expandedProduct === product.id ? 'ring-2 ring-emerald-500' : 'hover:shadow-md'}`}>
                <CardContent className="p-0">
                  <div 
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
                    onClick={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-gray-100 p-3 rounded-lg text-gray-500">
                        {product.hasVariants ? <Layers className="h-6 w-6" /> : <Package className="h-6 w-6" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg">{product.name}</h3>
                          {product.hasVariants && <Badge variant="secondary" className="text-[10px] h-4">MULTI-VARIANTS</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {getCategoryName(product.categoryId)}</span>
                          <span className="flex items-center gap-1 font-mono">{product.barcode || 'Pas de code-barres'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-8">
                      <div className="text-right">
                        <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Quantité totale</p>
                        <p className="text-xl font-black text-gray-900">
                          {product.quantity} <span className="text-sm font-normal text-gray-500">{getUnitSymbol(product.unitId)}</span>
                        </p>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Prix Moyen</p>
                        <p className="text-lg font-bold text-emerald-600">{product.sellingPrice.toLocaleString()} FCFA</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={getStockStatus(product)} />
                        {expandedProduct === product.id ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {expandedProduct === product.id && (
                    <div className="border-t bg-gray-50 p-6 space-y-6">
                      <Tabs defaultValue="overview">
                        <TabsList className="bg-white border">
                          <TabsTrigger value="overview">Détails Logistiques</TabsTrigger>
                          <TabsTrigger value="variants">Variantes ({product.variants?.length || 0})</TabsTrigger>
                          <TabsTrigger value="batches">TraÃ§abilité Lots ({product.batches?.length || 0})</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="overview" className="mt-4 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-lg border shadow-sm space-y-1">
                              <p className="text-xs text-gray-500 font-bold uppercase">Prix d'achat</p>
                              <p className="text-lg font-bold">{product.purchasePrice.toLocaleString()} FCFA</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border shadow-sm space-y-1">
                              <p className="text-xs text-gray-500 font-bold uppercase">Marge brute</p>
                              <p className="text-lg font-bold text-emerald-600">
                                {product.sellingPrice > 0 ? ((product.sellingPrice - product.purchasePrice) / product.sellingPrice * 100).toFixed(1) : 0}%
                              </p>
                            </div>
                            <div className="bg-white p-4 rounded-lg border shadow-sm space-y-1">
                              <p className="text-xs text-gray-500 font-bold uppercase">Seuil d'alerte</p>
                              <p className="text-lg font-bold">{product.minStockLevel} {getUnitSymbol(product.unitId)}</p>
                            </div>
                          </div>
                          <div className="p-4 bg-white border rounded-lg">
                            <h4 className="font-semibold mb-2 flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-emerald-600" /> Description & Notes
                            </h4>
                            <p className="text-sm text-gray-600 leading-relaxed">{product.description || 'Aucune description fournie.'}</p>
                          </div>
                        </TabsContent>

                        <TabsContent value="variants" className="mt-4">
                          {product.hasVariants ? (
                            <div className="bg-white border rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100 border-b">
                                  <tr>
                                    <th className="text-left p-3">Variante</th>
                                    <th className="text-left p-3">Code SKU</th>
                                    <th className="text-left p-3">Attributs</th>
                                    <th className="text-right p-3">Prix (+/-)</th>
                                    <th className="text-right p-3">Stock</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {product.variants?.map(v => (
                                    <tr key={v.id} className="border-b last:border-0 hover:bg-gray-50">
                                      <td className="p-3 font-medium">{v.name}</td>
                                      <td className="p-3 font-mono text-xs">{v.sku || '-'}</td>
                                      <td className="p-3">
                                        <div className="flex gap-1">
                                          {Object.entries(v.attributes).map(([k, val]) => (
                                            <Badge key={k} variant="outline" className="text-[9px] uppercase">{k}: {val}</Badge>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="p-3 text-right">
                                        {v.additionalPrice > 0 ? `+${v.additionalPrice}` : v.additionalPrice} FCFA
                                      </td>
                                      <td className="p-3 text-right font-bold">{v.quantity}</td>
                                      <td className="p-3 text-right">
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          className="h-7 w-7 text-gray-400 hover:text-emerald-600"
                                          onClick={(e) => { e.stopPropagation(); handlePrintLabels(product, v); }}
                                          title="Imprimer étiquettes"
                                        >
                                          <Printer className="h-3.5 w-3.5" />
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-8 text-center bg-white border rounded-lg border-dashed">
                              <p className="text-gray-500">Ce produit ne possÃ¨de pas de variantes.</p>
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="batches" className="mt-4">
                          <div className="bg-white border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-100 border-b">
                                <tr>
                                  <th className="text-left p-3">Numéro de Lot</th>
                                  <th className="text-left p-3">Réception</th>
                                  <th className="text-left p-3">Expiration</th>
                                  <th className="text-right p-3">Quantité Initiale</th>
                                  <th className="text-right p-3">Statut</th>
                                </tr>
                              </thead>
                              <tbody>
                                {product.batches?.map(b => {
                                  const isExpired = isBefore(new Date(b.expiryDate), new Date());
                                  return (
                                    <tr key={b.id} className="border-b last:border-0 hover:bg-gray-50">
                                      <td className="p-3 font-mono font-bold text-emerald-700">{b.batchNumber}</td>
                                      <td className="p-3">{format(new Date(b.receivedDate), 'dd/MM/yyyy')}</td>
                                      <td className={`p-3 ${isExpired ? 'text-red-600 font-bold' : ''}`}>
                                        {format(new Date(b.expiryDate), 'dd/MM/yyyy')}
                                      </td>
                                      <td className="p-3 text-right">{b.quantity}</td>
                                      <td className="p-3 text-right">
                                        {isExpired ? (
                                          <Badge variant="destructive">PÉRIMÉ</Badge>
                                        ) : (
                                          <Badge className="bg-emerald-500">CONFORME</Badge>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </TabsContent>
                      </Tabs>
                      
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700">
                          <Trash2 className="h-4 w-4 mr-2" /> Supprimer
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-emerald-600 border-emerald-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAdjustingProduct(product);
                            setIsAdjustDialogOpen(true);
                          }}
                        >
                          <ClipboardList className="h-4 w-4 mr-2" /> Ajuster Stock
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="text-emerald-600 border-emerald-200"
                          onClick={() => handlePrintLabels(product)}
                        >
                          <Printer className="h-4 w-4 mr-2" /> Étiquettes (Produit)
                        </Button>
                        <Button 
                          size="sm" 
                          className="bg-emerald-600"
                          onClick={() => {
                            setEditingProduct(product);
                            setIsDialogOpen(true);
                          }}
                        >
                          Éditer le produit
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modal Ajustement de Stock */}
      <Dialog open={isAdjustDialogOpen} onOpenChange={setIsAdjustDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Inventaire Physique & Ajustement</DialogTitle>
            <DialogDescription>
              Corrigez manuellement la Quantité en stock. Un mouvement de traÃ§abilité sera enregistré.
            </DialogDescription>
          </DialogHeader>
          {adjustingProduct && (
            <StockAdjustmentForm
              product={adjustingProduct}
              onSuccess={() => {
                setIsAdjustDialogOpen(false);
                if (tenant) fetchStockData(tenant.id);
              }}
              onCancel={() => setIsAdjustDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}



