import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  message: string;
  icon: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  icon: Icon,
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-surface-secondary/30 rounded-lg border border-dashed border-border-dark/30 h-full min-h-[160px]">
      <div className="w-12 h-12 rounded-full bg-surface-white border border-border-light shadow-sm flex items-center justify-center text-brand-slate/40 mb-3">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <h3 className="text-[14px] font-semibold text-brand-slate mb-1">{title}</h3>
      <p className="text-[13px] text-brand-slate/60 max-w-[280px] leading-snug">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 min-h-[40px] px-4 py-1.5 text-[13px] font-semibold text-brand-primary border border-brand-primary/30 rounded-md hover:bg-brand-primary/5 transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
