import { PackageSearch } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  imageSrc?: string; // Optionnel maintenant car on utilise un fallback SVG
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 bg-white rounded-xl border border-dashed border-gray-300">
      <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
        <PackageSearch className="w-12 h-12 text-emerald-500" />
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 text-center mb-8 max-w-md">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-all shadow-md active:scale-95"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
