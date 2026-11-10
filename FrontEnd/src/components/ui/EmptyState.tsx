import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  message: string;
  icon: LucideIcon;
}

export function EmptyState({ title, message, icon: Icon }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-surface-container-low/30 rounded-lg border border-dashed border-outline-variant/50">
      <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-outline mb-3">
        <Icon size={24} />
      </div>
      <h3 className="text-sm font-semibold text-on-surface mb-1">{title}</h3>
      <p className="text-xs text-outline max-w-xs">{message}</p>
    </div>
  );
}

export default EmptyState;
