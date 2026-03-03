import React from 'react';
import { cn } from '@/lib/utils';
import { FileX, AlertCircle, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'compact';
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div 
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in",
        variant === 'default' && 'py-16',
        variant === 'compact' && 'py-8',
        className
      )}
    >
      <div className={cn(
        "rounded-full bg-muted/60 flex items-center justify-center mb-4 ring-4 ring-muted/30",
        variant === 'default' && 'w-14 h-14',
        variant === 'compact' && 'w-10 h-10',
      )}>
        <Icon className={cn(
          "text-muted-foreground/60",
          variant === 'default' && 'w-6 h-6',
          variant === 'compact' && 'w-5 h-5',
        )} />
      </div>
      <h3 className={cn(
        "font-medium text-foreground",
        variant === 'default' && 'text-lg',
        variant === 'compact' && 'text-sm',
      )}>
        {title}
      </h3>
      {description && (
        <p className={cn(
          "text-muted-foreground mt-1 max-w-sm",
          variant === 'default' && 'text-sm',
          variant === 'compact' && 'text-xs',
        )}>
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = 'Chargement...', className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16", className)}>
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
      <p className="text-sm text-muted-foreground animate-pulse">{message}</p>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}

export function ErrorState({
  title = 'Une erreur est survenue',
  message = 'Impossible de charger les données. Veuillez réessayer.',
  action,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center animate-fade-in", className)}>
      <div className="w-14 h-14 rounded-full bg-severity-critical-bg flex items-center justify-center mb-4 ring-4 ring-severity-critical/10">
        <AlertCircle className="w-6 h-6 text-severity-critical" />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
