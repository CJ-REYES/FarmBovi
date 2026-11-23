import type { LucideIcon } from 'lucide-react';
import { BarChart2, PieChart } from 'lucide-react';
import type { DistributionItem } from '../../types/reports';
import EmptyState from '../ui/EmptyState';

const CHART_PALETTE = [
  '#1B5E20', // brand-primary
  '#2E7D32',
  '#F59E0B', // brand-yellow
  '#0284C7',
  '#DB2777',
  '#7C3AED',
  '#0D9488',
  '#EA580C',
  '#475569'
] as const;

export interface HorizontalBarChartProps {
  items: DistributionItem[];
  emptyTitle: string;
  emptyMessage: string;
  emptyIcon?: LucideIcon;
  barColorClass?: string;
  unitLabel?: string;
}

export function HorizontalBarChart({
  items,
  emptyTitle,
  emptyMessage,
  emptyIcon = BarChart2,
  barColorClass = 'bg-brand-primary',
  unitLabel = ''
}: HorizontalBarChartProps) {
  if (items.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title={emptyTitle} message={emptyMessage} icon={emptyIcon} />
      </div>
    );
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="space-y-3" role="list" aria-label={emptyTitle}>
      {items.map((item, idx) => {
        const widthPct = Math.max(4, Math.round((item.count / maxCount) * 100));
        return (
          <div key={item.key} role="listitem" className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-semibold text-brand-slate truncate" title={item.label}>
                {item.label}
              </span>
              <span className="text-brand-slate/75 shrink-0 tabular-nums">
                <strong className="text-brand-forest">{item.count}</strong>
                {unitLabel ? ` ${unitLabel}` : ''} · {item.percentage.toFixed(1)}%
                {item.detail ? ` (${item.detail})` : ''}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-surface-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
                style={{
                  width: `${widthPct}%`,
                  opacity: Math.max(0.55, 1 - idx * 0.06)
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface DonutDistributionChartProps {
  items: DistributionItem[];
  total: number;
  centerLabel: string;
  emptyTitle: string;
  emptyMessage: string;
  ariaLabel: string;
}

export function DonutDistributionChart({
  items,
  total,
  centerLabel,
  emptyTitle,
  emptyMessage,
  ariaLabel
}: DonutDistributionChartProps) {
  if (total === 0 || items.length === 0) {
    return (
      <div className="py-6">
        <EmptyState title={emptyTitle} message={emptyMessage} icon={PieChart} />
      </div>
    );
  }

  const size = 168;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = items.reduce<
    Array<{ item: DistributionItem; color: string; dashArray: string; dashOffset: number }>
  >((acc, item, idx) => {
    const previousFraction = items
      .slice(0, idx)
      .reduce((sum, prev) => sum + prev.count / total, 0);
    const fraction = item.count / total;
    const segmentLength = fraction * circumference;
    acc.push({
      item,
      color: CHART_PALETTE[idx % CHART_PALETTE.length],
      dashArray: `${segmentLength.toFixed(2)} ${(circumference - segmentLength).toFixed(2)}`,
      dashOffset: -(previousFraction * circumference)
    });
    return acc;
  }, []);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={ariaLabel}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg) => (
            <circle
              key={seg.item.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={seg.dashArray}
              strokeDashoffset={seg.dashOffset}
            >
              <title>
                {seg.item.label}: {seg.item.count} ({seg.item.percentage.toFixed(1)}%)
              </title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-3xl font-condensed font-bold text-brand-forest leading-none">
            {total}
          </span>
          <span className="text-[11px] font-semibold text-brand-slate/60 uppercase tracking-wider mt-1">
            {centerLabel}
          </span>
        </div>
      </div>

      <ul className="flex-1 w-full space-y-2">
        {segments.map((seg) => (
          <li
            key={seg.item.key}
            className="flex items-center justify-between gap-2 text-[13px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              <span className="font-medium text-brand-slate truncate">{seg.item.label}</span>
            </div>
            <span className="text-brand-slate/75 shrink-0 tabular-nums">
              <strong className="text-brand-forest">{seg.item.count}</strong> (
              {seg.item.percentage.toFixed(1)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
