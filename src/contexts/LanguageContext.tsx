import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Language = 'fr' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  fr: {
    // Auth
    'auth.login': 'Connexion',
    'auth.email': 'Email',
    'auth.password': 'Mot de passe',
    'auth.signin': 'Se connecter',
    'auth.logout': 'Déconnexion',
    'auth.forgotPassword': 'Mot de passe oublié ?',
    'auth.demoAccounts': 'Comptes de démonstration :',
    
    // Common
    'common.search': 'Rechercher',
    'common.add': 'Ajouter',
    'common.edit': 'Modifier',
    'common.delete': 'Supprimer',
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.actions': 'Actions',
    'common.status': 'Statut',
    'common.active': 'Actif',
    'common.inactive': 'Inactif',
    'common.loading': 'Chargement...',
    'common.noData': 'Aucune donnée',
    'common.selected': 'sélectionné(s)',
    'common.deleteSelection': 'Supprimer la sélection',
    
    // Navigation
    'nav.dashboard': 'Tableau de bord',
    'nav.depots': 'Dépôts',
    'nav.users': 'Utilisateurs',
    'nav.stock': 'Stock',
    'nav.sales': 'Ventes',
    'nav.vendors': 'Vendeurs',
    'nav.suppliers': 'Fournisseurs',
    'nav.reports': 'Rapports',
    'nav.settings': 'Paramètres',
    'nav.quickSale': 'Vente rapide',
    'nav.salesHistory': 'Historique',
    'nav.dayClose': 'Clôture journée',
    
    // Dashboard
    'dashboard.welcome': 'Bienvenue',
    'dashboard.overview': 'Vue d\'ensemble',
    'dashboard.todaySales': 'Ventes du jour',
    'dashboard.totalProducts': 'Produits en stock',
    'dashboard.lowStock': 'Stock faible',
    'dashboard.expired': 'Produits expirés',
    'dashboard.recentSales': 'Ventes récentes',
    'dashboard.alerts': 'Alertes importantes',
    
    // Products
    'products.name': 'Nom',
    'products.category': 'Catégorie',
    'products.quantity': 'Quantité',
    'products.price': 'Prix',
    'products.purchasePrice': 'Prix achat',
    'products.sellingPrice': 'Prix vente',
    'products.expiration': 'Expiration',
    'products.barcode': 'Code-barres',
    
    // Sales
    'sales.date': 'Date',
    'sales.vendor': 'Vendeur',
    'sales.items': 'Articles',
    'sales.amount': 'Montant',
    'sales.payment': 'Paiement',
    'sales.total': 'Total',
    
    // Dialogs
    'dialog.confirmDelete': 'Confirmer la suppression',
    'dialog.deleteMessage': 'Êtes-vous sûr de vouloir supprimer cet élément ? Cette action est irréversible.',
    'dialog.deleteMultipleMessage': 'Êtes-vous sûr de vouloir supprimer {count} élément(s) ? Cette action est irréversible.',
  },
  en: {
    // Auth
    'auth.login': 'Login',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signin': 'Sign in',
    'auth.logout': 'Logout',
    'auth.forgotPassword': 'Forgot password?',
    'auth.demoAccounts': 'Demo accounts:',
    
    // Common
    'common.search': 'Search',
    'common.add': 'Add',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.actions': 'Actions',
    'common.status': 'Status',
    'common.active': 'Active',
    'common.inactive': 'Inactive',
    'common.loading': 'Loading...',
    'common.noData': 'No data',
    'common.selected': 'selected',
    'common.deleteSelection': 'Delete selection',
    
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.depots': 'Depots',
    'nav.users': 'Users',
    'nav.stock': 'Stock',
    'nav.sales': 'Sales',
    'nav.vendors': 'Vendors',
    'nav.suppliers': 'Suppliers',
    'nav.reports': 'Reports',
    'nav.settings': 'Settings',
    'nav.quickSale': 'Quick Sale',
    'nav.salesHistory': 'History',
    'nav.dayClose': 'Day Close',
    
    // Dashboard
    'dashboard.welcome': 'Welcome',
    'dashboard.overview': 'Overview',
    'dashboard.todaySales': 'Today\'s Sales',
    'dashboard.totalProducts': 'Products in Stock',
    'dashboard.lowStock': 'Low Stock',
    'dashboard.expired': 'Expired Products',
    'dashboard.recentSales': 'Recent Sales',
    'dashboard.alerts': 'Important Alerts',
    
    // Products
    'products.name': 'Name',
    'products.category': 'Category',
    'products.quantity': 'Quantity',
    'products.price': 'Price',
    'products.purchasePrice': 'Purchase Price',
    'products.sellingPrice': 'Selling Price',
    'products.expiration': 'Expiration',
    'products.barcode': 'Barcode',
    
    // Sales
    'sales.date': 'Date',
    'sales.vendor': 'Vendor',
    'sales.items': 'Items',
    'sales.amount': 'Amount',
    'sales.payment': 'Payment',
    'sales.total': 'Total',
    
    // Dialogs
    'dialog.confirmDelete': 'Confirm Deletion',
    'dialog.deleteMessage': 'Are you sure you want to delete this item? This action is irreversible.',
    'dialog.deleteMultipleMessage': 'Are you sure you want to delete {count} item(s)? This action is irreversible.',
  }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    return (saved === 'en' || saved === 'fr') ? saved : 'fr';
  });

  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}