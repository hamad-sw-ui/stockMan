import { PluginManifest } from '@/types';

// Registre des plugins disponibles dans le système
const AVAILABLE_PLUGINS: PluginManifest[] = [
  {
    id: 'pos',
    name: 'Point de Vente (POS)',
    version: '1.0.0',
    description: 'Interface de vente rapide pour les caissiers.',
    author: 'RootRise Group',
    permissions: ['sale.create', 'product.view'],
    entryPoint: '/vendor/sale'
  },
  {
    id: 'stock',
    name: 'Gestion de Stock Avancée',
    version: '1.0.0',
    description: 'Alertes, variantes et inventaire multi-unités.',
    author: 'RootRise Group',
    permissions: ['product.create', 'product.edit', 'stock.adjust'],
    entryPoint: '/admin/stock'
  },
  {
    id: 'reports',
    name: 'Rapports & Analytique',
    version: '1.0.0',
    description: 'Graphiques avancés et exports PDF/Excel.',
    author: 'RootRise Group',
    permissions: ['report.view', 'report.export'],
    entryPoint: '/admin/reports'
  },
  {
    id: 'ai-stock',
    name: 'IA Prédiction de Stock',
    version: '0.5.0',
    description: 'Prédiction des ruptures de stock basée sur l\'historique.',
    author: 'RootRise Group',
    permissions: ['ai.view'],
    entryPoint: '/admin/ai-predictions'
  }
];

export function getAvailablePlugins(): PluginManifest[] {
  return AVAILABLE_PLUGINS;
}

export function getPluginById(id: string): PluginManifest | undefined {
  return AVAILABLE_PLUGINS.find(p => p.id === id);
}

export function isPluginActive(pluginId: string, activeModules: string[]): boolean {
  return activeModules.includes(pluginId);
}
