import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  CheckCircle,
  ArrowRight,
} from 'lucide-react';

type Severity = 'low' | 'medium' | 'high' | 'critical' | 'ok' | 'info';

interface SeverityBadgeProps {
  severity: Severity;
  showIcon?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function SeverityBadge({
  severity,
  showIcon = true,
  showLabel = true,
  size = 'md',
  className,
}: SeverityBadgeProps) {
  const getConfig = () => {
    switch (severity) {
      case 'critical':
        return {
          icon: AlertCircle,
          label: 'Critique',
          className: 'badge-critical',
        };
      case 'high':
        return {
          icon: AlertTriangle,
          label: 'Haute',
          className: 'badge-critical',
        };
      case 'medium':
        return {
          icon: AlertTriangle,
          label: 'Moyenne',
          className: 'badge-warning',
        };
      case 'low':
        return {
          icon: Info,
          label: 'Basse',
          className: 'badge-info',
        };
      case 'ok':
        return {
          icon: CheckCircle,
          label: 'OK',
          className: 'badge-ok',
        };
      case 'info':
      default:
        return {
          icon: Info,
          label: 'Info',
          className: 'badge-info',
        };
    }
  };
  
  const config = getConfig();
  const Icon = config.icon;
  
  return (
    <Badge 
      variant="outline"
      className={cn(
        config.className,
        size === 'sm' && 'text-[10px] px-1.5 py-0',
        size === 'md' && 'text-xs px-2 py-0.5',
        className
      )}
    >
      {showIcon && <Icon className={cn("mr-1", size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
      {showLabel && config.label}
    </Badge>
  );
}

interface StatusDotProps {
  status: 'online' | 'offline' | 'degraded' | 'ok' | 'warning' | 'critical';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ status, size = 'md', pulse, className }: StatusDotProps) {
  const getSizeClass = () => {
    switch (size) {
      case 'sm': return 'w-1.5 h-1.5';
      case 'lg': return 'w-3 h-3';
      default: return 'w-2 h-2';
    }
  };
  
  const getColorClass = () => {
    switch (status) {
      case 'online':
      case 'ok':
        return 'bg-status-online';
      case 'offline':
        return 'bg-status-offline';
      case 'degraded':
      case 'warning':
        return 'bg-status-degraded';
      case 'critical':
        return 'bg-severity-critical';
      default:
        return 'bg-muted-foreground';
    }
  };
  
  return (
    <span 
      className={cn(
        "rounded-full inline-block",
        getSizeClass(),
        getColorClass(),
        pulse && 'animate-pulse-soft',
        className
      )} 
    />
  );
}

interface DataQualityIndicatorProps {
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  showLabel?: boolean;
  className?: string;
}

export function DataQualityIndicator({ quality, showLabel = true, className }: DataQualityIndicatorProps) {
  const getConfig = () => {
    switch (quality) {
      case 'excellent':
        return { color: 'bg-data-excellent', label: 'Excellent', bars: 4 };
      case 'good':
        return { color: 'bg-data-good', label: 'Bon', bars: 3 };
      case 'fair':
        return { color: 'bg-data-fair', label: 'Moyen', bars: 2 };
      case 'poor':
        return { color: 'bg-data-poor', label: 'Faible', bars: 1 };
    }
  };
  
  const config = getConfig();
  
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex items-end gap-0.5 h-3">
        {[1, 2, 3, 4].map(i => (
          <span 
            key={i}
            className={cn(
              "w-1 rounded-sm",
              i <= config.bars ? config.color : 'bg-muted',
              i === 1 && 'h-1',
              i === 2 && 'h-1.5',
              i === 3 && 'h-2',
              i === 4 && 'h-3',
            )}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">{config.label}</span>
      )}
    </div>
  );
}
