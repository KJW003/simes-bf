import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HarmonicsData } from '@/types';

type PhaseKey = 'phaseA' | 'phaseB' | 'phaseC';

function formatPct(v: number) {
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

function topHarmonics(h: HarmonicsData[], phase: PhaseKey, topN = 5) {
  return [...h]
    .sort((a, b) => (b.values[phase] ?? 0) - (a.values[phase] ?? 0))
    .slice(0, topN)
    .map((x) => ({ order: x.order, value: x.values[phase] ?? 0 }));
}

export function HarmonicsPanel({ harmonics }: { harmonics: HarmonicsData[] }) {
  const [phase, setPhase] = useState<PhaseKey>('phaseA');

  const data = useMemo(
    () =>
      (harmonics ?? [])
        .filter((d) => d.order >= 2 && d.order <= 31)
        .sort((a, b) => a.order - b.order)
        .map((d) => ({
          order: d.order,
          value: d.values[phase] ?? 0,
        })),
    [harmonics, phase]
  );

  const top = useMemo(() => topHarmonics(harmonics ?? [], phase, 5), [harmonics, phase]);

  return (
    <div className="space-y-3">
      <Tabs value={phase} onValueChange={(v) => setPhase(v as PhaseKey)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="phaseA">Phase A</TabsTrigger>
          <TabsTrigger value="phaseB">Phase B</TabsTrigger>
          <TabsTrigger value="phaseC">Phase C</TabsTrigger>
        </TabsList>

        <TabsContent value={phase} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Top harmoniques :</span>
            {top.length === 0 ? (
              <Badge variant="secondary">—</Badge>
            ) : (
              top.map((t) => (
                <Badge key={t.order} variant="secondary" className="mono">
                  H{t.order} {formatPct(t.value)}
                </Badge>
              ))
            )}
          </div>

          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-medium">Harmoniques (2–31)</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="order"
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      tickFormatter={(v) => `H${v}`}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatPct(v)}
                      labelFormatter={(l) => `H${l}`}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '10px',
                        fontSize: '11px',
                      }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--chart-1))" name="Amplitude" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Affichage par phase (ADW300). Les amplitudes sont en % (selon la convention de l’onduleur/compteur).
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
