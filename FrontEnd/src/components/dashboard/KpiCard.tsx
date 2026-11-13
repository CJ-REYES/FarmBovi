import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  icon: LucideIcon;
  value: string | number;
  unit?: string;
  sub?: string;
  color: string;
}

export function KpiCard({ title, icon: Icon, value, unit, sub, color }: KpiCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-sm relative overflow-hidden flex flex-col justify-between h-32">
      <div className="flex items-center justify-between mb-2">
        <span className="font-barlow text-[13px] font-bold text-outline uppercase tracking-widest">{title}</span>
        <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant">
          <Icon size={18} />
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="font-barlow text-3xl text-on-surface font-bold">{value}</span>
          <span className="font-barlow text-[13px] font-bold text-outline">{unit}</span>
        </div>
        <div className="mt-1 text-xs text-outline truncate">{sub}</div>
      </div>
      <div className={`absolute bottom-0 left-0 right-0 h-1 ${color}`}></div>
    </div>
  );
}

export default KpiCard;
