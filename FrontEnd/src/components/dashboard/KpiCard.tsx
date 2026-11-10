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
    <div className="bg-surface-white border border-border-light rounded-xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] relative overflow-hidden flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-brand-slate/60 uppercase tracking-widest">{title}</span>
        <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center text-brand-primary">
          <Icon size={18} />
        </div>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="font-condensed text-3xl text-brand-slate font-bold">{value}</span>
          {unit && <span className="font-condensed text-[14px] font-bold text-brand-slate/60">{unit}</span>}
        </div>
        {sub && <div className="mt-1 text-[12px] font-medium text-brand-slate/60 truncate">{sub}</div>}
      </div>
      <div className={`absolute bottom-0 left-0 right-0 h-1 ${color}`}></div>
    </div>
  );
}

export default KpiCard;
