import { useEffect, useState } from 'react';
import VendorLayout from '@/layouts/VendorLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { Search, AlertTriangle } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import type { Product } from '@/types';

export default function VendorStockView() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadProducts();
  }, [user]);

  async function loadProducts() {
    if (!user?.depotId) return;
    const allProducts = await db.products.where('depotId').equals(user.depotId).toArray();
    setProducts(allProducts);
  }

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStockStatus = (product: Product) => {
    const now = new Date();
    if (product.expirationDate && new Date(product.expirationDate) < now) {
      return 'expired';
    }
    if (product.quantity <= product.minStockLevel) {
      return 'low_stock';
    }
    return 'active';
  };

  return (
    <VendorLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Consulter le stock</h1>
          <p className="text-gray-600 mt-2">Vue en lecture seule des produits disponibles</p>
        </div>

        {products.length === 0 ? (
          <EmptyState
            title="Aucun produit"
            description="Le stock est vide"
            imageSrc="https://mgx-backend-cdn.metadl.com/generate/images/916314/2026-01-17/a00a2e40-24b5-4436-bd3a-d6a6e0d768a7.png"
          />
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Rechercher un produit..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map((product) => {
                  const status = getStockStatus(product);
                  return (
                    <div key={product.id} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{product.name}</h4>
                          <p className="text-sm text-gray-600">{product.category}</p>
                        </div>
                        <StatusBadge status={status} />
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Quantité:</span>
                          <span className={`font-medium ${status === 'low_stock' || status === 'expired' ? 'text-red-600' : 'text-gray-900'}`}>
                            {product.quantity}
                            {status === 'low_stock' && (
                              <AlertTriangle className="inline h-4 w-4 ml-1 text-orange-500" />
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Prix:</span>
                          <span className="font-bold text-green-600">
                            {product.sellingPrice.toLocaleString()} FCFA
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  Aucun produit trouvé
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </VendorLayout>
  );
}