import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Delete, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '@/lib/db';
import type { Tenant } from '@/types';

export default function PinLoginPage() {
  const { loginWithPin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');

  useEffect(() => {
    async function loadTenants() {
      const allTenants = await db.tenants.toArray();
      setTenants(allTenants);
      if (allTenants.length > 0) {
        setSelectedTenantId(allTenants[0].id);
      }
    }
    loadTenants();
  }, []);

  const handleNumberClick = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('Le code PIN doit contenir au moins 4 chiffres');
      return;
    }

    if (!selectedTenantId) {
      setError('Veuillez sélectionner une organisation');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await loginWithPin(pin, selectedTenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code PIN invalide');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (pin.length === 6) {
      handleSubmit();
    }
  }, [pin]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Card className="w-full max-w-md shadow-xl border-t-4 border-emerald-500">
        <CardHeader className="text-center">
          <div className="mx-auto bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <span className="text-emerald-600 font-bold text-xl">POS</span>
          </div>
          <CardTitle className="text-2xl">Accès Rapide Caissier</CardTitle>
          <CardDescription>Entrez votre code PIN pour commencer la vente</CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Organisation</label>
            <select 
              className="w-full p-2 border rounded-md bg-white"
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
            >
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-center gap-3 my-8">
            {[...Array(6)].map((_, i) => (
              <div 
                key={i}
                className={`w-4 h-4 rounded-full border-2 ${
                  pin.length > i ? 'bg-emerald-500 border-emerald-500' : 'bg-transparent border-gray-300'
                } transition-all duration-200`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <Button
                key={num}
                variant="outline"
                className="h-16 text-2xl font-semibold hover:bg-emerald-50 hover:text-emerald-600 border-gray-200"
                onClick={() => handleNumberClick(num.toString())}
                disabled={isLoading}
              >
                {num}
              </Button>
            ))}
            <Link to="/login" className="flex items-center justify-center">
              <Button variant="ghost" size="icon" className="h-16 w-full text-gray-500">
                <ArrowLeft className="h-6 w-6" />
              </Button>
            </Link>
            <Button
              variant="outline"
              className="h-16 text-2xl font-semibold hover:bg-emerald-50 hover:text-emerald-600 border-gray-200"
              onClick={() => handleNumberClick('0')}
              disabled={isLoading}
            >
              0
            </Button>
            <Button
              variant="ghost"
              className="h-16 text-emerald-600 hover:bg-emerald-50"
              onClick={handleDelete}
              disabled={isLoading || pin.length === 0}
            >
              <Delete className="h-6 w-6" />
            </Button>
          </div>

          <Button 
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 mt-4 text-lg"
            onClick={handleSubmit}
            disabled={isLoading || pin.length < 4}
          >
            {isLoading ? 'Vérification...' : 'Valider'}
          </Button>

          <div className="mt-4 p-3 bg-blue-50 rounded text-xs text-blue-700">
            <strong>Note de démo :</strong> Le vendeur par défaut n'a pas encore de PIN. Utilisez l'admin pour lui en assigner un ou modifiez directement la base.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
