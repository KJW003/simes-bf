import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2 } from 'lucide-react';

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  requiredKeyword: string;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onConfirm: () => void;
  onCancel?: () => void;
  error?: string | null;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  children?: React.ReactNode;
};

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  requiredKeyword,
  confirmText,
  onConfirmTextChange,
  onConfirm,
  onCancel,
  error,
  confirmLabel = 'Confirmer',
  busy = false,
  destructive = true,
  children,
}: ConfirmActionDialogProps) {
  const canConfirm = requiredKeyword.length > 0 && confirmText.trim().toUpperCase() === requiredKeyword;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <div className="space-y-1.5">
          <Label className="text-xs">
            Tapez <strong>{requiredKeyword}</strong> pour confirmer
          </Label>
          <Input
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder={requiredKeyword}
          />
          <p className="text-[11px] text-muted-foreground">
            Format attendu: <strong>{requiredKeyword}</strong>
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={!canConfirm || busy}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
