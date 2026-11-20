import { Scale } from 'lucide-react';
import type { WeightEvolutionPoint } from '../../types/weighing';
import EmptyState from '../ui/EmptyState';

export interface WeightEvolutionChartProps {
  points: WeightEvolutionPoint[];
  subtitle?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onSelectWeighingId?: (weighingId: string) => void;
}

export default function WeightEvolutionChart({
  points,
  subtitle,
  emptyActionLabel,
  onEmptyAction,
  onSelectWeighingId
}: WeightEvolutionChartProps) {
  if (points.length < 2) {
    return (
      <div className="h-full min-h-[240px] flex items-center justify-center p-4">
        <EmptyState
          title="Datos insuficientes para graficar"
          message={
            points.length === 1
              ? `Existe 1 pesaje registrado (${points[0].pesoKg.toFixed(1)} kg). Registra al menos un segundo pesaje en otra fecha para graficar la evolución real.`
              : 'Registra al menos 2 pesajes reales para generar la gráfica de evolución de peso y calcular la GDP.'
          }
          icon={Scale}
          actionLabel={emptyActionLabel}
          onAction={onEmptyAction}
        />
      </div>
    );
  }

  const width = 680;
  const height = 240;
  const padLeft = 56;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 38;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const weights = points.map((p) => p.pesoKg);
  const rawMin = Math.min(...weights);
  const rawMax = Math.max(...weights);
  const spread = rawMax - rawMin;
  const margin = spread > 0 ? Math.max(spread * 0.15, 5) : Math.max(rawMax * 0.1, 10);
  const yMin = Math.max(0, Math.floor(rawMin - margin));
  const yMax = Math.ceil(rawMax + margin);
  const yRange = Math.max(1, yMax - yMin);

  const coords = points.map((pt, idx) => {
    const x =
      points.length === 1
        ? padLeft + chartW / 2
        : padLeft + (idx / (points.length - 1)) * chartW;
    const y = padTop + chartH - ((pt.pesoKg - yMin) / yRange) * chartH;
    return { ...pt, x, y };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = yMin + ratio * yRange;
    const y = padTop + chartH - ratio * chartH;
    return { value: Math.round(value), y };
  });

  // Limitar etiquetas del eje X para evitar solapamiento en series largas
  const maxXLabels = 6;
  const labelStep = Math.max(1, Math.ceil(coords.length / maxXLabels));

  const firstWeight = points[0].pesoKg;
  const lastWeight = points[points.length - 1].pesoKg;
  const netDelta = Math.round((lastWeight - firstWeight) * 100) / 100;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-brand-slate/75">
        <span>{subtitle || `${points.length} puntos reales graficados`}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Inicial: <strong className="text-brand-slate">{firstWeight.toFixed(1)} kg</strong>
          </span>
          <span>
            Último: <strong className="text-brand-forest">{lastWeight.toFixed(1)} kg</strong>
          </span>
          <span
            className={`font-bold ${
              netDelta > 0
                ? 'text-status-success'
                : netDelta < 0
                  ? 'text-status-error'
                  : 'text-brand-slate'
            }`}
          >
            {netDelta > 0 ? `+${netDelta.toFixed(1)}` : netDelta.toFixed(1)} kg
          </span>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          role="img"
          aria-label="Gráfica de evolución real de peso en kilogramos"
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[320px] max-h-[260px]"
        >
          <defs>
            <linearGradient id="weightEvolutionFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Cuadrícula horizontal y escala Y (kg) */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={tick.y}
                y2={tick.y}
                stroke="#E5E7EB"
                strokeDasharray={i === 0 ? undefined : '4 4'}
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748B"
              >
                {tick.value} kg
              </text>
            </g>
          ))}

          {/* Área bajo la curva */}
          <path d={areaPath} fill="url(#weightEvolutionFill)" className="text-brand-primary" />

          {/* Línea de evolución */}
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand-primary"
          />

          {/* Puntos reales y etiquetas del eje X */}
          {coords.map((pt, idx) => {
            const showLabel = idx === 0 || idx === coords.length - 1 || idx % labelStep === 0;
            const clickable = Boolean(pt.weighingId && onSelectWeighingId);
            return (
              <g key={pt.id}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={clickable ? 5 : 4}
                  fill="#FFFFFF"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`text-brand-forest ${clickable ? 'cursor-pointer' : ''}`}
                  onClick={() => {
                    if (pt.weighingId && onSelectWeighingId) {
                      onSelectWeighingId(pt.weighingId);
                    }
                  }}
                >
                  <title>
                    {pt.label}: {pt.pesoKg.toFixed(1)} kg
                    {pt.sampleCount > 1 ? ` (promedio de ${pt.sampleCount} pesajes)` : ''}
                  </title>
                </circle>

                <text
                  x={pt.x}
                  y={pt.y - 10}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="#1F2937"
                >
                  {pt.pesoKg.toFixed(1)}
                </text>

                {showLabel && (
                  <text
                    x={pt.x}
                    y={height - 12}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#64748B"
                  >
                    {pt.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
