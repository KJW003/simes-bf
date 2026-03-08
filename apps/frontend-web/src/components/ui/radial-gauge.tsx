import React from 'react';
import { cn } from '@/lib/utils';

interface RadialGaugeProps {
  value: number;
  min?: number;
  max?: number;
  label: string;
  unit: string;
  size?: number;
  strokeWidth?: number;
  thresholds?: Array<{ value: number; color: string }>;
  className?: string;
}

export function RadialGauge({
  value,
  min = 0,
  max = 100,
  label,
  unit,
  size = 140,
  strokeWidth = 10,
  thresholds,
  className,
}: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;

  // Arc from -135° to +135° (270° sweep)
  const startAngle = -225;
  const endAngle = 45;
  const sweepAngle = 270;

  const clampedValue = Math.max(min, Math.min(max, value));
  const ratio = (clampedValue - min) / (max - min);
  const valueAngle = startAngle + ratio * sweepAngle;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (from: number, to: number) => {
    const x1 = center + radius * Math.cos(toRad(from));
    const y1 = center + radius * Math.sin(toRad(from));
    const x2 = center + radius * Math.cos(toRad(to));
    const y2 = center + radius * Math.sin(toRad(to));
    const largeArc = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Get color based on thresholds
  const getColor = () => {
    if (!thresholds?.length) return 'hsl(var(--primary))';
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (clampedValue >= thresholds[i].value) return thresholds[i].color;
    }
    return thresholds[0]?.color ?? 'hsl(var(--primary))';
  };

  const color = getColor();

  // Needle endpoint
  const needleLen = radius - 8;
  const needleX = center + needleLen * Math.cos(toRad(valueAngle));
  const needleY = center + needleLen * Math.sin(toRad(valueAngle));

  // Tick marks
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={size * 0.8} viewBox={`0 0 ${size} ${size * 0.85}`}>
        {/* Background arc */}
        <path
          d={arcPath(startAngle, endAngle)}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Value arc */}
        {ratio > 0.005 && (
          <path
            d={arcPath(startAngle, valueAngle)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              filter: `drop-shadow(0 0 4px ${color}40)`,
              transition: 'all 0.6s ease-out',
            }}
          />
        )}

        {/* Tick marks */}
        {ticks.map((t, i) => {
          const angle = startAngle + t * sweepAngle;
          const outerR = radius + strokeWidth / 2 + 2;
          const innerR = radius + strokeWidth / 2 + 6;
          const ox = center + outerR * Math.cos(toRad(angle));
          const oy = center + outerR * Math.sin(toRad(angle));
          const ix = center + innerR * Math.cos(toRad(angle));
          const iy = center + innerR * Math.sin(toRad(angle));
          return (
            <line
              key={i}
              x1={ox} y1={oy} x2={ix} y2={iy}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              opacity={0.4}
            />
          );
        })}

        {/* Needle */}
        <line
          x1={center} y1={center}
          x2={needleX} y2={needleY}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          style={{ transition: 'all 0.6s ease-out' }}
        />
        <circle cx={center} cy={center} r={4} fill={color} />
        <circle cx={center} cy={center} r={2} fill="hsl(var(--card))" />

        {/* Value text */}
        <text
          x={center}
          y={center + 22}
          textAnchor="middle"
          className="fill-foreground"
          fontSize={size * 0.14}
          fontWeight="600"
          fontFamily="'JetBrains Mono', monospace"
        >
          {typeof value === 'number' ? value.toFixed(value >= 100 ? 0 : 1) : '—'}
        </text>
        <text
          x={center}
          y={center + 36}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          {unit}
        </text>

        {/* Min / Max labels */}
        <text
          x={center - radius + 5}
          y={center + 14}
          textAnchor="start"
          className="fill-muted-foreground"
          fontSize={8}
        >
          {min}
        </text>
        <text
          x={center + radius - 5}
          y={center + 14}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize={8}
        >
          {max}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground -mt-1">{label}</span>
    </div>
  );
}
