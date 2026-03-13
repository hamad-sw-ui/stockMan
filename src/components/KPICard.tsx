import { Card, CardContent } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export default function KPICard({ title, value, icon: Icon, trend, className = '' }: KPICardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
            {trend && (
              <p className={`text-sm mt-2 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {trend.isPositive ? '+' : ''}{trend.value}%
              </p>
            )}
          </div>
          <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
            <Icon className="h-6 w-6 text-green-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}