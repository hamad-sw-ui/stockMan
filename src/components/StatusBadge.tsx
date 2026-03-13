import { Badge } from '@/components/ui/badge';

type StatusType = 'active' | 'inactive' | 'low_stock' | 'expired' | 'near_expiry' | 'success' | 'warning' | 'danger';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  active: { label: 'Actif', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  inactive: { label: 'Inactif', className: 'bg-gray-100 text-gray-800 hover:bg-gray-100' },
  low_stock: { label: 'Stock faible', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  expired: { label: 'Expiré', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  near_expiry: { label: 'Proche expiration', className: 'bg-orange-100 text-orange-800 hover:bg-orange-100' },
  success: { label: 'Succès', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  warning: { label: 'Attention', className: 'bg-orange-100 text-orange-800 hover:bg-orange-100' },
  danger: { label: 'Danger', className: 'bg-red-100 text-red-800 hover:bg-red-100' }
};

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge className={config.className}>
      {label || config.label}
    </Badge>
  );
}