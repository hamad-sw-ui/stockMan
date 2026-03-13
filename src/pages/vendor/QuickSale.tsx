import { useEffect, useState } from 'react';
import VendorLayout from '@/layouts/VendorLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db, logAction } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Product, PaymentMethod, Sale, SaleItem } from '@/types';
import { Search, Plus, Trash2, ShoppingCart } from 'lucide-react';

export default function VendorQuickSale() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  useEffect(() => {
    loadProducts();
  }, [user]);

  async function loadProducts() {
    if (!user?.depotId) return;
    const allProducts = await db.products
      .where('depotId')
      .equals(user.depotId)
      .and(p => p.quantity > 0)
      .toArray();
    setProducts(allProducts);
  }

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (product.barcode && product.barcode.includes(searchTerm))
  );

  const addToCart = (product: Product) => {
    const existingItem = cart.find(item => item.productId === product.id);
    
    if (existingItem) {
      if (existingItem.quantity >= product.quantity) {
        toast.error('Stock insuffisant');
        return;
      }
      setCart(cart.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice }
          : item
      ));
    } else {
      setCart([...cart, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.sellingPrice,
        totalPrice: product.sellingPrice
      }]);
    }
    toast.success(`${product.name} ajouté au panier`);
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    if (newQuantity > product.quantity) {
      toast.error('Stock insuffisant');
      return;
    }

    if (newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCart(cart.map(item =>
      item.productId === productId
        ? { ...item, quantity: newQuantity, totalPrice: newQuantity * item.unitPrice }
        : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const handleSubmitSale = async () => {
    if (cart.length === 0) {
      toast.error('Le panier est vide');
      return;
    }

    if (!user) return;

    try {
      // Créer la vente
      const sale: Sale = {
        id: `sale-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        depotId: user.depotId!,
        vendorId: user.id,
        vendorName: user.name,
        items: cart,
        totalAmount,
        paymentMethod,
        createdAt: new Date(),
        syncedAt: new Date()
      };

      await db.sales.add(sale);

      // Décrémenter le stock
      for (const item of cart) {
        const product = await db.products.get(item.productId);
        if (product) {
          await db.products.update(item.productId, {
            quantity: product.quantity - item.quantity,
            updatedAt: new Date()
          });
        }
      }

      // Logger l'action
      await logAction(
        user.id,
        user.name,
        'CREATE',
        'sale',
        sale.id,
        `Vente de ${totalAmount} FCFA avec ${cart.length} article(s)`,
        user.depotId
      );

      toast.success('Vente enregistrée avec succès!');
      
      // Réinitialiser
      setCart([]);
      setPaymentMethod('CASH');
      loadProducts();
    } catch (error) {
      toast.error('Erreur lors de l\'enregistrement de la vente');
      console.error(error);
    }
  };

  return (
    <VendorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vente rapide</h1>
          <p className="text-gray-600 mt-2">Enregistrer une nouvelle vente</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Liste des produits */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Sélectionner des produits</CardTitle>
                <div className="relative mt-4">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Rechercher par nom ou code-barres..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {filteredProducts.map((product) => (
                    <div
                      key={product.id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 cursor-pointer transition-colors"
                      onClick={() => addToCart(product)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{product.name}</h4>
                          <p className="text-sm text-gray-600">{product.category}</p>
                          <p className="text-lg font-bold text-green-600 mt-2">
                            {product.sellingPrice.toLocaleString()} FCFA
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">Stock: {product.quantity}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {filteredProducts.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    Aucun produit disponible
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Panier */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Panier ({cart.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.productId} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-medium text-sm">{item.productName}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 1)}
                          className="w-20 h-8"
                        />
                        <span className="text-sm text-gray-600">x {item.unitPrice.toLocaleString()}</span>
                        <span className="text-sm font-bold text-green-600 ml-auto">
                          {item.totalPrice.toLocaleString()} FCFA
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {cart.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    Le panier est vide
                  </div>
                )}

                <div className="border-t pt-4 space-y-4">
                  <div className="flex items-center justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span className="text-green-600">{totalAmount.toLocaleString()} FCFA</span>
                  </div>

                  <div className="space-y-2">
                    <Label>Mode de paiement</Label>
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="MTN_MOMO">MTN Mobile Money</SelectItem>
                        <SelectItem value="ORANGE_MONEY">Orange Money</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="w-full bg-green-600 hover:bg-green-700"
                    onClick={handleSubmitSale}
                    disabled={cart.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Valider la vente
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </VendorLayout>
  );
}