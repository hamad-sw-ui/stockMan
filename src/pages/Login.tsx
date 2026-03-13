import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCcw, ShieldAlert, Boxes } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleEmergencyReset = () => {
    if (confirm("⚠️ Réinitialisation d'urgence : Cela va vider le cache et la base de données locale. Continuer ?")) {
      indexedDB.deleteDatabase('StockManDB');
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 relative overflow-hidden">
      {/* Bouton de secours discret */}
      <button 
        onClick={handleEmergencyReset}
        className="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors z-50"
        title="Réinitialisation d'urgence"
      >
        <ShieldAlert className="h-6 w-6" />
      </button>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="mx-auto bg-emerald-600 w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-xl transform rotate-6 border-4 border-white">
            <Boxes className="text-white h-10 w-10" />
          </div>
          <h1 className="text-4xl font-black text-gray-900 tracking-tighter">StockMan <span className="text-emerald-600">v1.0</span></h1>
          <p className="text-gray-500 mt-2 font-medium">Gestion de dépôts intelligente • Cameroun</p>
        </div>

        <Card className="shadow-2xl border-none ring-1 ring-gray-200">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl">Connexion</CardTitle>
            <CardDescription>Entrez vos identifiants pour accéder à votre compte</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email professionnel</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="nom@depot.cm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Mot de passe</Label>
                  <button type="button" className="text-xs text-emerald-600 hover:underline">Oublié ?</button>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg font-bold shadow-lg shadow-emerald-100" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <RefreshCcw className="mr-2 h-5 w-5 animate-spin" />
                    Authentification...
                  </>
                ) : 'Se connecter'}
              </Button>
            </form>

            <div className="mt-8 border-t pt-6">
              <Link to="/login-pin" className="w-full">
                <Button variant="outline" className="w-full border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 h-12 font-bold uppercase tracking-wider text-xs">
                  Accès Rapide Vendeur (Code PIN)
                </Button>
              </Link>
            </div>

            <div className="mt-8 p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
              <p className="text-[10px] font-bold text-emerald-800 mb-3 uppercase tracking-widest">Comptes de test</p>
              <div className="grid grid-cols-1 gap-2 text-[11px] text-emerald-900/70 font-medium">
                <div className="flex justify-between items-center bg-white p-2 rounded border border-emerald-100 shadow-sm">
                  <span>Super Admin</span>
                  <code className="bg-emerald-100 px-1 rounded text-emerald-700">superadmin@depot.cm</code>
                </div>
                <div className="flex justify-between items-center bg-white p-2 rounded border border-emerald-100 shadow-sm">
                  <span>Administrateur</span>
                  <code className="bg-emerald-100 px-1 rounded text-emerald-700">admin@depot.cm</code>
                </div>
              </div>
              <p className="text-[9px] text-center mt-3 text-emerald-600/50 italic">Mot de passe par défaut : login + 123 (ex: admin123)</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Décoration de fond */}
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-emerald-100 rounded-full blur-3xl opacity-50"></div>
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-emerald-50 rounded-full blur-3xl opacity-50"></div>
    </div>
  );
}
