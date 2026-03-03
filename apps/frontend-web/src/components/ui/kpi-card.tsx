import React from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>
>;

interface KpiCardProps {
  title?: string;
  label?: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  icon?: IconComponent | React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
  variant?: 'default' | 'success' | 'warning' | 'critical';
  className?: string;
}

export function KpiCard({
  title,
  label,
  value,
  unit,
  subtitle,
  icon,
  trend,
  variant = 'default',
  className,
}: KpiCardProps) {
  const displayTitle = title ?? label ?? '';
  const getVariantStyles = () => {
    switch (variant) {
      case 'success':
        return 'border-l-4 border-l-severity-ok';
      case 'warning':
        return 'border-l-4 border-l-severity-warning';
      case 'critical':
        return 'border-l-4 border-l-severity-critical';
      default:
        return '';
    }
  };

  const isIconComponent = (
    icon?: IconComponent | React.ReactNode
  ): icon is IconComponent => {
    return icon && typeof icon === 'function' && 'displayName' in icon;
  };

  const renderIcon = () => {
    if (!icon) return null;
    if (isIconComponent(icon)) {
      const Icon = icon;
      return (
        <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      );
    }
    return <div className="text-muted-foreground">{icon}</div>;
  };

  const getTrendColor = () => {
    if (!trend) return '';
    if (trend.direction === 'up') return 'text-severity-ok';
    if (trend.direction === 'down') return 'text-severity-critical';
    return 'text-muted-foreground';
  };

  return (
    <div className={cn('kpi-card', getVariantStyles(), className)}>
      <div className="flex items-start justify-between">
        <span className="kpi-label text-sm font-medium">{displayTitle}</span>
        {renderIcon()}
      </div>
      <div className="kpi-value mt-2">
        <span className="mono text-2xl font-semibold">{value}</span>
        {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
      </div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
      {trend && (
        <div className={cn('kpi-change flex items-center gap-1 mt-2 text-xs font-medium', getTrendColor())}>
          {trend.direction === 'up' ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          <span>{trend.value > 0 ? '+' : ''}{trend.value.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}
