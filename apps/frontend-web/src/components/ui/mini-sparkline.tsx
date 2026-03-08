import React from 'react';

interface MiniSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
}

export function MiniSparkline({
  data,
  width = 80,
  height = 24,
  color = 'hsl(var(--primary))',
  fillOpacity = 0.15,
  className,
}: MiniSparklineProps) {
  if (!data.length || data.every(v => v === 0)) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - 2 * pad);
    const y = height - pad - ((v - min) / range) * (height - 2 * pad);
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L ${width - pad},${height} L ${pad},${height} Z`;

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`}>
      <path d={fillPath} fill={color} opacity={fillOpacity} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      {data.length > 0 && (
        <circle
          cx={width - pad}
          cy={height - pad - ((data[data.length - 1] - min) / range) * (height - 2 * pad)}
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}
