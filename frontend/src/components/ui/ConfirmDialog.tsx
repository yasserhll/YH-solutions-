import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Supprimer', onConfirm, onCancel, isLoading }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <AlertTriangle size={20} />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          Annuler
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={isLoading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
