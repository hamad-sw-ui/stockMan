import { Banknote, Smartphone } from 'lucide-react';
import type { PaymentMethod } from '@/types';

interface PaymentMethodIconProps {
  method: PaymentMethod;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6'
};

export default function PaymentMethodIcon({ method, showLabel = false, size = 'md' }: PaymentMethodIconProps) {
  const iconSize = sizeClasses[size];

  const config = {
    CASH: {
      icon: <Banknote className={iconSize} />,
      label: 'Cash',
      color: 'text-gray-700'
    },
    MTN_MOMO: {
      icon: <Smartphone className={iconSize} />,
      label: 'MTN MoMo',
      color: 'text-yellow-600'
    },
    ORANGE_MONEY: {
      icon: <Smartphone className={iconSize} />,
      label: 'Orange Money',
      color: 'text-orange-600'
    }
  };

  const { icon, label, color } = config[method];

  if (showLabel) {
    return (
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
    );
  }

  return <div className={color}>{icon}</div>;
}