# Cahier des Charges - Application de Gestion de Dépôts (App-Depot)

## 1. Présentation du Projet
L'application **App-Depot** est une solution de gestion commerciale et de stock (PWA - Progressive Web App) spécifiquement conçue pour le contexte camerounais. Elle permet aux propriétaires de dépôts et de boutiques de digitaliser leur activité, de sécuriser leurs transactions et de suivre leurs stocks en temps réel, même en l'absence de connexion internet.

## 2. Objectifs Stratégiques
*   **Centralisation** : Regrouper la gestion de plusieurs dépôts sur une seule interface (Super Admin).
*   **Mobilité & Accessibilité** : Fonctionner sur smartphones bas de gamme via une interface web installable (PWA).
*   **Fiabilité (Offline-First)** : Permettre la saisie de ventes et la consultation de stock sans internet, avec synchronisation automatique.
*   **Transparence** : Tracer chaque action critique (ventes, modifications de stock) via un journal d'audit rigoureux.

## 3. Analyse Fonctionnelle (Par Rôle)

### A. Super Administrateur (Gestion Globale)
*   **Dashboard Consolidé** : Vue d'ensemble du chiffre d'affaires de tous les dépôts.
*   **Gestion des Dépôts** : Création, suspension et configuration des points de vente.
*   **Gestion des Comptes** : Création et attribution des rôles Admin et Vendeur.
*   **Reporting de Haut Niveau** : Exportation de rapports consolidés (PDF/Excel).

### B. Administrateur / Propriétaire (Gestion du Dépôt)
*   **Gestion du Catalogue** : Ajout/Modification de produits (Prix d'achat, Prix de vente, Seuil d'alerte).
*   **Suivi de Stock** : Inventaire en temps réel, alertes de stock faible (Rouge) et produits périmés.
*   **Gestion des Fournisseurs** : Historique des commandes et réapprovisionnements.
*   **Analyse de Performance** : Graphiques de ventes, calcul du bénéfice net, produits les plus rentables.
*   **Surveillance** : Consultation du journal d'audit des vendeurs.

### C. Vendeur (Opérations de Caisse)
*   **Interface de Vente Rapide** : Sélection de produits, saisie des quantités et validation.
*   **Modes de Paiement Locaux** : Support du Cash, MTN Mobile Money (Jaune), Orange Money (Orange).
*   **Consultation de Stock** : Vérification rapide de la disponibilité d'un article.
*   **Clôture de Journée** : Génération d'un rapport de ventes personnel en fin de shift.

## 4. Spécifications Techniques

### Stack Technologique (Frontend)
*   **Framework** : React 19 + Vite + TypeScript.
*   **UI/UX** : Tailwind CSS + Shadcn UI (Radix UI).
*   **Gestion d'État** : Zustand (Global) + TanStack Query (Server State).
*   **Base de Données Locale** : Dexie.js (IndexedDB) pour le stockage offline.
*   **Visualisation** : Recharts pour les graphiques analytiques.

### Architecture Offline-First
*   **Service Workers** : Mise en cache des assets via Workbox.
*   **Synchronisation** : File d'attente de synchronisation en arrière-plan (Background Sync) pour renvoyer les données locales vers le serveur une fois la connexion rétablie.

## 5. Charte Graphique & UX
*   **Couleur Primaire** : `#10B981` (Vert Émeraude - Succès, Argent/FCFA).
*   **Couleur Accent** : `#F59E0B` (Orange - Mobile Money, Alertes).
*   **Typographie** : Inter (700 pour les titres, 400 pour le corps).
*   **Principe "3 Clics"** : Toute action critique (vendre, vérifier un stock) doit être réalisable en moins de 3 clics.
*   **Responsive** : Mobile-first (optimisé pour écrans 5 à 6.5 pouces).

## 6. Sécurité & Intégrité
*   **RBAC (Role-Based Access Control)** : Accès restreint selon le niveau de permission.
*   **Audit Log** : Enregistrement immuable (Utilisateur, Action, Horodatage, Détails) pour prévenir les fraudes.
*   **Validation** : Double validation des entrées (Client-side avec Zod + Server-side).

## 7. Livrables & Planning
1.  **MVP (Minimum Viable Product)** : Gestion de stock de base + Module de vente Cash.
2.  **Version 1.1** : Intégration Mobile Money + Mode Offline complet.
3.  **Version 1.2** : Dashboard Admin avancé + Exports PDF/Excel.
4.  **Version Finale** : Gestion multi-dépôts (Super Admin) + Audit logs avancés.

## 8. Arborescence & Détails des Pages (Qui, Quoi, Où, Quand)

### 8.1. Authentification (Tous les utilisateurs)
*   **Page de Connexion (`/login`)**
    *   **Quoi** : Formulaire sécurisé (Email/Mot de passe).
    *   **Quand** : Au démarrage de l'application ou après expiration de session.
    *   **Éléments** : Illustration "Hero" (Dépôt moderne), bouton de connexion, lien "Mot de passe oublié".
    *   **Action** : Redirection automatique vers le Dashboard correspondant au rôle détecté.

### 8.2. Espace SUPER ADMIN (Gestion multi-sites)
*   **Dashboard Global (`/superadmin`)**
    *   **Quoi** : Vue "Hélicoptère" de l'entreprise.
    *   **Éléments** : Cartes KPI (Chiffre d'affaires total, Top 3 dépôts performants, Alertes système).
*   **Gestion des Dépôts (`/superadmin/depots`)**
    *   **Quoi** : Création et monitoring des points de vente.
    *   **Action** : Ajouter un nouveau dépôt (Nom, Localisation, Admin responsable).
*   **Gestion des Utilisateurs (`/superadmin/users`)**
    *   **Quoi** : Annuaire centralisé.
    *   **Action** : Créer des comptes Admins, réinitialiser des mots de passe, suspendre un compte suspect.

### 8.3. Espace ADMIN / PROPRIÉTAIRE (Gestion d'un dépôt)
*   **Tableau de Bord Local (`/admin`)**
    *   **Quoi** : Pilotage quotidien du dépôt.
    *   **Éléments** : Graphique des ventes de la semaine, liste des "Urgences" (Stocks épuisés, Produits périmés aujourd'hui).
*   **Gestion du Stock (`/admin/stock`)**
    *   **Quoi** : Cœur de l'inventaire.
    *   **Éléments** : Tableau filtrable, bouton "Ajouter un produit", indicateur de statut (Vert=OK, Orange=Faible, Rouge=Critique).
    *   **Action** : Mise à jour des prix, ajustement des quantités après inventaire physique.
*   **Module Vendeurs (`/admin/vendors`)**
    *   **Quoi** : Management de l'équipe.
    *   **Action** : Créer des accès vendeurs, consulter les performances de vente par employé.
*   **Rapports & Finances (`/admin/reports`)**
    *   **Quoi** : Comptabilité et analyse.
    *   **Action** : Générer le bilan mensuel en PDF, exporter les ventes vers Excel pour la fiscalité.

### 8.4. Espace VENDEUR (Opérations Terrain)
*   **Vente Rapide / POS (`/vendor/sale`)**
    *   **Quoi** : L'interface la plus utilisée.
    *   **Éléments** : Barre de recherche rapide (ou scanner), panier virtuel, sélecteur de paiement (Cash/MoMo/Orange).
    *   **Quand** : À chaque transaction client.
    *   **Action** : Valider la vente -> Décrémentation automatique du stock + Enregistrement dans l'audit.
*   **Consultation Stock (`/vendor/inventory`)**
    *   **Quoi** : Aide à la vente.
    *   **Quand** : Quand un client demande la disponibilité ou le prix d'un article.
    *   **Éléments** : Liste simplifiée en lecture seule.
*   **Clôture de Caisse (`/vendor/close`)**
    *   **Quoi** : Rapport de fin de journée.
    *   **Quand** : Avant de quitter le dépôt.
    *   **Action** : Déclarer le montant en espèces encaissé, valider le récapitulatif pour envoi à l'Admin.

### 8.5. Éléments Transversaux (L'expérience utilisateur)
*   **Barre de Navigation (Sidebar)** : Adaptative selon le rôle. Elle contient le bouton "Déconnexion" et l'indicateur d'état de connexion (Online/Offline).
*   **Système de Notifications (Toasts)** : Messages éphémères confirmant une action ("Vente réussie", "Erreur de synchro").
*   **Modales de Confirmation** : Fenêtres surgissantes pour valider les actions irréversibles (ex: "Voulez-vous vraiment supprimer ce produit ?").
*   **Banner Offline** : Bandeau orange s'affichant en haut de l'écran quand internet est coupé, informant que les données sont stockées localement.

---
*Document généré le 10 Mars 2026 pour le projet App-Depot.*