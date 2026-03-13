import { useState, useEffect } from 'react';
import { useLicenseStore } from '@/store/useLicenseStore';
import { useTenantStore } from '@/store/useTenantStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  CreditCard, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  ShieldCheck, 
  Users, 
  Building2, 
  Settings, 
  RefreshCw,
  Search,
  Plus
} from 'lucide-react';
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
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { format, isAfter } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { License, LicenseStatus } from '@/types';

export default function LicencesPage() {
  const { licenses, fetchAllLicenses, updateLicense, isLoading } = useLicenseStore();
  const { tenants, fetchTenants } = useTenantStore();
  
  const [filter, setFilter] = useState('');
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    fetchTenants();
    fetchAllLicenses();
  }, []);

  const getTenantName = (tenantId: string) => {
    return tenants.find(t => t.id === tenantId)?.name || 'Inconnu';
  };

  const getStatusBadge = (license: License) => {
    const isExpired = !isAfter(new Date(license.endDate), new Date());
    
    if (license.status === 'ACTIVE' && !isExpired) {
      return <Badge className="bg-emerald-500">ACTIVE</Badge>;
    }
    if (isExpired || license.status === 'EXPIRED') {
      return <Badge variant="destructive">EXPIRÉE</Badge>;
    }
    if (license.status === 'SUSPENDED') {
      return <Badge variant="outline" className="text-red-600 border-red-600">SUSPENDUE</Badge>;
    }
    if (license.status === 'TRIAL') {
      return <Badge className="bg-blue-500">ESSAI</Badge>;
    }
    return <Badge>{license.status}</Badge>;
  };

  const handleUpdateLicense = async () => {
    if (!editingLicense) return;
    
    try {
      await updateLicense(editingLicense.id, editingLicense);
      toast.success('Licence mise à jour avec succès');
      setIsDialogOpen(false);
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const filteredLicenses = licenses.filter(l => 
    getTenantName(l.tenantId).toLowerCase().includes(filter.toLowerCase()) ||
    l.planName.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-8 w-8 text-blue-600" />
            Abonnements & Licences
          </h1>
          <p className="text-muted-foreground">Pilotez les revenus et contrôlez les accès de vos clients.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="mr-2 h-4 w-4" /> Nouvelle Licence
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-blue-50 border-blue-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Licences Actives
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-900">
              {licenses.filter(l => l.status === 'ACTIVE').length} / {licenses.length}
            </div>
            <p className="text-xs text-blue-700">Taux de rétention : 92%</p>
          </CardContent>
        </Card>
        
        <Card className="bg-emerald-50 border-emerald-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Revenus MRR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-900">1,250,000 FCFA</div>
            <p className="text-xs text-emerald-700">+15% ce mois-ci</p>
          </CardContent>
        </Card>

        <Card className="bg-orange-50 border-orange-100">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Expirations Proches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-900">4 Clients</div>
            <p className="text-xs text-orange-700">Renouvellement sous 7 jours</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle>Gestion des abonnements</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input 
                placeholder="Chercher un client..." 
                className="pl-9 w-[250px]"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Client (Tenant)</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Limites (Dépôts/Users)</TableHead>
                  <TableHead>Expiration</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10">
                      <RefreshCw className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                    </TableCell>
                  </TableRow>
                ) : filteredLicenses.length > 0 ? (
                  filteredLicenses.map((l) => (
                    <TableRow key={l.id} className="hover:bg-gray-50/50">
                      <TableCell className="font-medium">
                        {getTenantName(l.tenantId)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-bold border-blue-500 text-blue-600">
                          {l.planName}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(l)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" /> {l.maxDepots}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" /> {l.maxUsers}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(l.endDate), 'dd MMM yyyy', { locale: fr })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog open={isDialogOpen && editingLicense?.id === l.id} onOpenChange={(open) => {
                          setIsDialogOpen(open);
                          if (!open) setEditingLicense(null);
                        }}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" onClick={() => setEditingLicense(l)}>
                              <Settings className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Configurer l'Abonnement</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <label className="text-sm font-medium">Plan d'abonnement</label>
                                <Select 
                                  value={editingLicense?.planName} 
                                  onValueChange={(v) => editingLicense && setEditingLicense({...editingLicense, planName: v})}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Choisir un plan" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Lite">Lite (Gratuit)</SelectItem>
                                    <SelectItem value="Pro">Professionnel</SelectItem>
                                    <SelectItem value="Enterprise">Entreprise</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm font-medium">Statut</label>
                                <Select 
                                  value={editingLicense?.status} 
                                  onValueChange={(v) => editingLicense && setEditingLicense({...editingLicense, status: v as LicenseStatus})}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Changer le statut" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ACTIVE">Activer l'accès</SelectItem>
                                    <SelectItem value="SUSPENDED">Suspendre l'accès</SelectItem>
                                    <SelectItem value="EXPIRED">Forcer l'expiration</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">Dépôts Max</label>
                                  <Input 
                                    type="number" 
                                    value={editingLicense?.maxDepots}
                                    onChange={(e) => editingLicense && setEditingLicense({...editingLicense, maxDepots: parseInt(e.target.value)})}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium">Utilisateurs Max</label>
                                  <Input 
                                    type="number" 
                                    value={editingLicense?.maxUsers}
                                    onChange={(e) => editingLicense && setEditingLicense({...editingLicense, maxUsers: parseInt(e.target.value)})}
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-sm font-medium">Date d'expiration</label>
                                <Input 
                                  type="date" 
                                  value={editingLicense ? format(new Date(editingLicense.endDate), 'yyyy-MM-dd') : ''}
                                  onChange={(e) => editingLicense && setEditingLicense({...editingLicense, endDate: new Date(e.target.value)})}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
                              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleUpdateLicense}>
                                Enregistrer les changements
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-20 text-gray-500">
                      <CreditCard className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                      Aucune licence trouvée.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
