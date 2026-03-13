# Plan de Développement Détaillé : App-Depot → StockMan v1.0

Ce document définit la stratégie de transformation de l'application **App-Depot** vers la plateforme **StockMan v1.0**, basée sur l'analyse comparative et le guide d'implémentation technique.

## 1. État des Lieux & Analyse d'Écart
*   **Conformité actuelle** : ~35%
*   **Points Forts (Existant)** : Gestion de base (vente, stock simple), gestion de rôles, mode offline (PWA).
*   **Points Critiques à Combler** :
    *   Architecture SaaS Multi-Tenant (Isolation des données).
    *   Système de Plugins & Event Bus (Core Engine immuable).
    *   Permissions granulaires (RBAC avancé).
    *   Gestion des licences et abonnements.

## 2. Plan de Développement par Phases

### Phase 1 : Refonte de l'Architecture Core (Priorité : Critique)
*   **Objectif** : Passer d'une application mono-tenant à un système SaaS modulaire.
*   **Actions** :
    *   Implémentation du **Tenant Isolator** (schémas séparés).
    *   Création du **Plugin Loader** et du système de manifest.
    *   Mise en place du **License Manager** (vérification horaire).
    *   Évolution du système d'audit (Logs AVANT/APRÈS).

### Phase 2 : Expansion du Frontend (Cible v0.7)
*   **Nouvelles Pages (18 au total)** :
    *   *Super Admin* : Gestion des tenants, Licences, Modules (.zip), Logs réseau temps réel.
    *   *Admin* : Dashboard KPI avancé, Configuration multi-unités, Paramètres de thémage.
    *   *Vendeur* : Mode caissier accès rapide (PIN), Consultation de stock avancée.
*   **Nouveaux Stores Zustand (8)** : `useTenantStore`, `useLicenseStore`, `useModuleStore`, `useAuditStore`, etc.
*   **Modèles Dexie.js (12)** : Mise à jour du schéma local pour supporter le multi-tenant et les plugins.

### Phase 3 : Module Catalogue & Multi-Unités
*   **Objectif** : Gérer la complexité des stocks professionnels.
*   **Actions** :
    *   Gestion multi-unités (ex: carton -> pack -> unité).
    *   Système de variantes (couleur, taille, poids).
    *   Gestion des lots et dates de péremption (FEFO/FIFO).
    *   Impression d'étiquettes code-barres personnalisées.

### Phase 4 : Connectivité & Intelligence
*   **Objectif** : Automatisation et notifications.
*   **Actions** :
    *   Intégration **WhatsApp API** et **SMS (Africa's Talking)** pour les alertes de stock.
    *   Moteur de notifications push.
    *   Rapports prédictifs basés sur l'historique des ventes.

## 3. Architecture Technique Cible
*   **Frontend** : React 19, Vite, Tailwind CSS, Zustand, TanStack Query.
*   **Offline** : Dexie.js (IndexedDB) + Workbox (Service Workers) + CRDT pour la résolution de conflits.
*   **Mobile/Desktop** : Migration prévue vers Capacitor (Mobile) et Electron/Tauri (Desktop).

## 4. Indicateurs de Succès (KPI)
*   **Conformité StockMan** : Atteindre 100% à la fin de la phase 4.
*   **Zéro Conflit Offline** : 100% de succès lors de la synchronisation des données.
*   **Performance** : Temps de chargement < 2s sur smartphones d'entrée de gamme (cible marché africain).

---
*Plan stratégique établi le 10 Mars 2026 - RootRise Group.*
