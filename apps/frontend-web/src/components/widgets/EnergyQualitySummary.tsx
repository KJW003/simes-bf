import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export type EnergyQualityRange = '1D' | '7D' | '1M' | '3M' | '6M' | '1Y';

export type EnergyQualityMetrics = {
  powerKw: number;
  energyKwh: number;
  pfAvg: number;
  thdMax: number;
};

const RANGE_OPTIONS: { key: EnergyQualityRange; label: string; days: number }[] = [
  { key: '1D', label: '1D', days: 1 },
  { key: '7D', label: '7D', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1Y', label: '1Y', days: 365 },
];

const defaultMetrics: EnergyQualityMetrics = {
  powerKw: 184.2,
  energyKwh: 2850,
  pfAvg: 0.89,
  thdMax: 7.8,
};

type EnergyQualitySummaryProps = {
  size?: 'sm' | 'md' | 'lg';
  metrics?: Partial<EnergyQualityMetrics>;
  showSparkline?: boolean;
  title?: string;
};

export function EnergyQualitySummary({
  size = 'md',
  metrics,
  showSparkline = true,
  title = 'Energy Quality Summary',
}: EnergyQualitySummaryProps) {
  const [range, setRange] = useState<EnergyQualityRange>('1M');

  const mergedPowerKw = metrics?.powerKw ?? defaultMetrics.powerKw;
  const mergedEnergyKwh = metrics?.energyKwh ?? defaultMetrics.energyKwh;
  const mergedPfAvg = metrics?.pfAvg ?? defaultMetrics.pfAvg;
  const mergedThdMax = metrics?.thdMax ?? defaultMetrics.thdMax;
  const rangeInfo = RANGE_OPTIONS.find(opt => opt.key === range) ?? RANGE_OPTIONS[2];

  const computed = useMemo(() => {
    const energy = mergedEnergyKwh * rangeInfo.days;
    const pfDelta = rangeInfo.days >= 90 ? -0.01 : rangeInfo.days >= 30 ? -0.005 : 0;
    const thdDelta = rangeInfo.days >= 90 ? 0.6 : rangeInfo.days >= 30 ? 0.3 : 0.1;
    return {
      powerKw: mergedPowerKw,
      energyKwh: energy,
      pfAvg: Math.max(0.7, Math.min(0.99, mergedPfAvg + pfDelta)),
      thdMax: Math.max(0, mergedThdMax + thdDelta),
    };
  }, [mergedPowerKw, mergedEnergyKwh, mergedPfAvg, mergedThdMax, rangeInfo.days]);

  const sparkline = useMemo(() => {
    const points = size === 'sm' ? 18 : size === 'md' ? 24 : 36;
    return Array.from({ length: points }, (_, i) => {
      const factor = Math.sin((i / points) * Math.PI * 2);
      return {
        t: i,
        v: computed.powerKw + factor * 18 + (i % 4) * 2,
      };
    });
  }, [computed.powerKw, size]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <div className="flex flex-wrap items-center gap-1">
          {RANGE_OPTIONS.map(opt => (
            <Button
              key={opt.key}
              size="sm"
              variant={range === opt.key ? 'default' : 'ghost'}
              className="h-6 px-2 text-[10px]"
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={cn('grid gap-3', size === 'sm' ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4')}>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Puissance (kW)</div>
          <div className="text-lg font-semibold mono">{computed.powerKw.toFixed(1)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Énergie (kWh)</div>
          <div className="text-lg font-semibold mono">{computed.energyKwh.toLocaleString()}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">PF moyen</div>
          <div className={cn('text-lg font-semibold mono', computed.pfAvg < 0.85 && 'text-severity-warning')}>
            {computed.pfAvg.toFixed(2)}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">THD max</div>
          <div className={cn('text-lg font-semibold mono', computed.thdMax > 10 && 'text-severity-warning')}>
            {computed.thdMax.toFixed(1)}%
          </div>
        </div>
      </div>

      {showSparkline && size !== 'sm' && (
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
                formatter={(value: number) => [`${value.toFixed(1)} kW`, 'Puissance']}
              />
              <Line type="monotone" dataKey="v" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
