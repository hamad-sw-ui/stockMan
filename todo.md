# Application de Gestion de Dépôts - Cameroun
## Plan de Développement PWA

## Directives de Design

### Références de Design
- **Style**: Dashboard moderne avec accent sur la simplicité et la clarté
- **Inspiration**: Applications de gestion africaines (Wave, MTN MoMo), dashboards administratifs modernes
- **Principe UX**: Maximum 3 clics pour toute action critique

### Palette de Couleurs
- Primary: #10B981 (Vert Emeraude - succès, validation, FCFA)
- Secondary: #1F2937 (Gris Foncé - navigation, cartes)
- Accent: #F59E0B (Orange - alertes importantes, Mobile Money)
- Danger: #EF4444 (Rouge - stock faible, périmé, erreurs)
- Background: #F9FAFB (Gris Très Clair - fond principal)
- Text: #111827 (Noir - texte principal), #6B7280 (Gris - texte secondaire)

### Typographie
- Heading1: Inter font-weight 700 (32px) - Titres de pages
- Heading2: Inter font-weight 600 (24px) - Sections
- Heading3: Inter font-weight 600 (18px) - Sous-sections
- Body/Normal: Inter font-weight 400 (14px) - Texte courant
- Body/Emphasis: Inter font-weight 600 (14px) - Texte important
- Navigation: Inter font-weight 500 (16px) - Menu

### Composants Clés
- **Cartes**: Fond blanc, bordure grise légère, ombre subtile, coins arrondis 8px
- **Boutons Primaires**: Vert (#10B981), texte blanc, hover: assombrir 10%
- **Boutons Secondaires**: Gris (#6B7280), texte blanc, hover: assombrir 10%
- **Boutons Danger**: Rouge (#EF4444), texte blanc, hover: assombrir 10%
- **Badges**: Arrondis complets, tailles petites, couleurs selon statut
- **Alertes**: Bordure gauche épaisse (4px), icône, fond coloré léger

### Layout & Espacement
- Navigation latérale: 256px de largeur, collapsible sur mobile
- Padding sections: 24px
- Espacement cartes: 16px gap
- Responsive: Mobile-first, breakpoints Tailwind standards

### Images à Générer
1. **logo-depot.png** - Logo de l'application (icône de dépôt/entrepôt stylisé) (Style: minimalist, vert et orange)
2. **hero-dashboard.jpg** - Image d'illustration pour page de connexion (dépôt africain moderne) (Style: photorealistic, lumineux)
3. **empty-state-products.svg** - Illustration état vide pour liste produits (Style: vector-style, simple)
4. **empty-state-sales.svg** - Illustration état vide pour ventes (Style: vector-style, simple)

### Icônes et Symboles
- Devise: FCFA (toujours affichée)
- Mobile Money: Icônes MTN (jaune) et Orange (orange)
- Alertes: Utiliser lucide-react icons (AlertCircle, AlertTriangle, CheckCircle)

---

## Tâches de Développement

### Phase 1: Configuration et Structure de Base

**1.1 Configuration PWA**
- Installer workbox pour Service Workers
- Créer manifest.json pour installation mobile
- Configurer stratégies de cache (offline-first)

**1.2 Configuration IndexedDB**
- Installer dexie.js pour gestion IndexedDB
- Créer schéma de base de données locale
- Tables: users, depots, products, stocks, sales, payments, suppliers, audit_logs

**1.3 Structure de Fichiers**
- src/lib/db.ts - Configuration IndexedDB
- src/lib/auth.ts - Gestion authentification
- src/lib/sync.ts - Synchronisation offline
- src/contexts/AuthContext.tsx - Context React pour auth
- src/hooks/useOffline.ts - Hook détection offline
- src/types/index.ts - Types TypeScript

### Phase 2: Système d'Authentification

**2.1 Types et Modèles**
- Définir types User, Role (SUPER_ADMIN, ADMIN, VENDEUR)
- Interface AuthState, LoginCredentials

**2.2 Page de Connexion**
- src/pages/Login.tsx
- Formulaire avec email/password
- Validation côté client
- Gestion erreurs
- Option "Mot de passe oublié"
- Stockage JWT simulé dans localStorage

**2.3 Context d'Authentification**
- Provider global
- Fonctions login/logout
- Protection des routes
- Vérification des permissions RBAC

### Phase 3: Interface Super Admin

**3.1 Layout Super Admin**
- src/layouts/SuperAdminLayout.tsx
- Navigation latérale avec menu
- Header avec profil utilisateur
- Breadcrumb

**3.2 Dashboard Super Admin**
- src/pages/superadmin/Dashboard.tsx
- Statistiques globales (nombre dépôts, utilisateurs, ventes totales)
- Graphiques: Chart.js ou Recharts
- Cartes de résumé (KPI cards)

**3.3 Gestion des Dépôts**
- src/pages/superadmin/Depots.tsx
- Liste des dépôts avec DataTable
- Modal création/édition dépôt
- Activation/désactivation dépôt
- Filtres et recherche

**3.4 Gestion des Comptes**
- src/pages/superadmin/Users.tsx
- Liste utilisateurs tous rôles
- Création Admin/Vendeur
- Attribution dépôt
- Suspension compte

**3.5 Paramètres Système**
- src/pages/superadmin/Settings.tsx
- Configuration devise (FCFA)
- Types de produits standards
- Seuils de stock par défaut
- Configuration Mobile Money

**3.6 Rapports Consolidés**
- src/pages/superadmin/Reports.tsx
- Filtres par date, dépôt
- Export PDF/Excel (react-pdf, xlsx)
- Graphiques comparatifs

### Phase 4: Interface Admin/Propriétaire

**4.1 Layout Admin**
- src/layouts/AdminLayout.tsx
- Navigation adaptée au rôle Admin
- Sélecteur de dépôt (si multi-dépôts)

**4.2 Dashboard Admin**
- src/pages/admin/Dashboard.tsx
- Ventes du jour (FCFA)
- Stock faible (alertes rouges)
- Produits périmés
- Bénéfice net/perte
- Graphiques de tendances

**4.3 Gestion du Stock**
- src/pages/admin/Stock.tsx
- Liste produits avec DataTable
- Modal ajout/édition produit
- Champs: nom, quantité, prix achat, prix vente, date expiration
- Alertes visuelles (stock faible, périmé)
- Recherche et filtres

**4.4 Module Ventes et Caisse**
- src/pages/admin/Sales.tsx
- Liste des ventes du jour
- Détails par vente: produits, quantité, montant, mode paiement
- Filtres: date, vendeur, mode paiement
- Historique complet

**4.5 Gestion Utilisateurs (Vendeurs)**
- src/pages/admin/Vendors.tsx
- Liste vendeurs du dépôt
- Création/édition vendeur
- Définition permissions
- Statistiques par vendeur

**4.6 Gestion Fournisseurs**
- src/pages/admin/Suppliers.tsx
- CRUD fournisseurs
- Historique commandes
- Alertes réapprovisionnement
- Suggestions automatiques

**4.7 Rapports Admin**
- src/pages/admin/Reports.tsx
- Rapports journaliers, hebdomadaires, mensuels
- Export PDF/Excel
- Graphiques détaillés

### Phase 5: Interface Vendeur

**5.1 Layout Vendeur**
- src/layouts/VendorLayout.tsx
- Navigation simplifiée
- Accès limité

**5.2 Dashboard Vendeur**
- src/pages/vendor/Dashboard.tsx
- Produits disponibles
- Alertes stock faible
- Alertes produits périmés
- Résumé ventes personnelles

**5.3 Module Vente Rapide**
- src/pages/vendor/QuickSale.tsx
- Sélection produit (recherche, scan code simulé)
- Saisie quantité
- Choix mode paiement (Cash, MTN MoMo, Orange Money)
- Validation avec confirmation
- Décrémentation automatique du stock
- Enregistrement dans audit log

**5.4 Historique des Ventes**
- src/pages/vendor/SalesHistory.tsx
- Liste ventes personnelles
- Filtres par date
- Montant total et quantité

**5.5 Consultation Stock**
- src/pages/vendor/StockView.tsx
- Vue lecture seule
- Recherche produits
- Alertes visuelles

**5.6 Clôture de Journée**
- src/pages/vendor/DayClose.tsx
- Rapport quotidien simplifié
- Récapitulatif ventes
- Bouton "Envoyer au propriétaire"

### Phase 6: Fonctionnalités Transversales

**6.1 Mode Hors Ligne**
- Service Worker avec Workbox
- Stratégie cache-first pour assets
- Network-first pour données
- Queue de synchronisation (background sync)
- Indicateur visuel état connexion
- Résolution conflits (timestamp)

**6.2 Système d'Alertes**
- src/components/AlertSystem.tsx
- Notifications toast (sonner)
- Badges de notification
- Centre de notifications
- Types: stock faible, périmé, commande retard

**6.3 Audit Log**
- Enregistrement automatique actions critiques
- src/lib/auditLog.ts
- Fonction logAction(user, action, details)
- Stockage IndexedDB
- Consultation par Admin/Super Admin

**6.4 Recherche et Filtres**
- Composant réutilisable SearchFilter
- Filtres par date, catégorie, statut
- Recherche en temps réel
- Sauvegarde préférences utilisateur

**6.5 Export PDF/Excel**
- Utiliser jsPDF et jspdf-autotable
- Utiliser xlsx pour Excel
- Templates de rapports
- Logo et en-tête personnalisés

### Phase 7: Design et UX

**7.1 Composants Réutilisables**
- src/components/KPICard.tsx - Cartes statistiques
- src/components/DataTable.tsx - Tableaux de données
- src/components/StatusBadge.tsx - Badges de statut
- src/components/PaymentMethodIcon.tsx - Icônes paiement
- src/components/AlertBanner.tsx - Bannières d'alerte
- src/components/EmptyState.tsx - États vides

**7.2 Thème et Styles**
- Configuration Tailwind personnalisée
- Variables CSS pour couleurs
- Dark mode (optionnel)
- Animations subtiles (transitions)

**7.3 Responsive Design**
- Mobile-first approach
- Navigation mobile (hamburger menu)
- Cartes adaptatives
- Tableaux scrollables sur mobile

**7.4 Accessibilité**
- Labels ARIA
- Navigation clavier
- Contraste couleurs (WCAG AA)
- Focus visible

### Phase 8: Tests et Optimisation

**8.1 Tests Fonctionnels**
- Vérifier flux complet vente
- Tester mode hors ligne
- Valider synchronisation
- Tester tous les rôles

**8.2 Optimisation Performance**
- Lazy loading des pages
- Optimisation images
- Minification code
- Code splitting

**8.3 Validation Finale**
- Lint (pnpm run lint)
- Build (pnpm run build)
- Test responsive
- Test cross-browser

---

## Dépendances à Ajouter

```bash
pnpm add dexie date-fns recharts jspdf jspdf-autotable xlsx lucide-react
pnpm add -D workbox-webpack-plugin
```

---

## Notes Importantes

- **Devise**: Toujours afficher FCFA
- **Mobile Money**: Icônes distinctes pour MTN MoMo (jaune) et Orange Money (orange)
- **UX Simplifiée**: Maximum 3 clics pour actions critiques
- **Offline-First**: Application doit fonctionner sans Internet
- **Audit**: Toute action critique doit être loguée
- **Sécurité**: Validation côté client + simulation backend
- **Performance**: Optimisé pour smartphones bas de gamme