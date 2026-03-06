import React, { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useLogs, useLogStats } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import {
  FileSearch, AlertTriangle, Info, AlertOctagon, RefreshCw, Loader2, Search,
} from 'lucide-react';

const levelConfig: Record<string, { label: string; className: string; icon: any }> = {
  info: { label: 'Info', className: 'text-blue-600 bg-blue-50 border-blue-200', icon: Info },
  warn: { label: 'Warning', className: 'text-amber-600 bg-amber-50 border-amber-200', icon: AlertTriangle },
  error: { label: 'Error', className: 'text-red-600 bg-red-50 border-red-200', icon: AlertOctagon },
};

const fmtDate = (d: string) => new Date(d).toLocaleString('fr-FR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export default function Logs() {
  const [levelFilter, setLevelFilter] = useState<string>('_all');
  const [sourceFilter, setSourceFilter] = useState<string>('_all');
  const [searchText, setSearchText] = useState('');

  const params = {
    ...(levelFilter !== '_all' ? { level: levelFilter } : {}),
    ...(sourceFilter !== '_all' ? { source: sourceFilter } : {}),
    ...(searchText ? { search: searchText } : {}),
    limit: 200,
  };

  const { data, isLoading, refetch } = useLogs(params);
  const { data: stats } = useLogStats();

  const logs = data?.logs ?? [];
  const statMap = Object.fromEntries((stats?.stats ?? []).map((s: any) => [s.level, s.count]));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Logs"
        description="Journal système de la plateforme (dernières 24h)"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />Actualiser
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-stagger-children">
        <KpiCard label="Total 24h" value={data?.total ?? 0} icon={<FileSearch className="w-4 h-4" />} />
        <KpiCard label="Info" value={statMap.info ?? 0} icon={<Info className="w-4 h-4" />} />
        <KpiCard label="Warnings" value={statMap.warn ?? 0} icon={<AlertTriangle className="w-4 h-4" />} variant={statMap.warn > 0 ? 'warning' : 'default'} />
        <KpiCard label="Errors" value={statMap.error ?? 0} icon={<AlertOctagon className="w-4 h-4" />} variant={statMap.error > 0 ? 'critical' : 'default'} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Niveau :</span>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Tous</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground ml-2">Source :</span>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Toutes</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="ingestion">Ingestion</SelectItem>
            <SelectItem value="worker">Worker</SelectItem>
            <SelectItem value="system">Système</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-2">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 text-xs pl-7 w-48"
            placeholder="Rechercher…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* Log Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Logs ({data?.total ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Aucun log trouvé</div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="data-table text-xs w-full">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="bg-muted/50">
                    <th className="py-2 px-2 w-20">Heure</th>
                    <th className="py-2 px-2 w-16">Niveau</th>
                    <th className="py-2 px-2 w-20">Source</th>
                    <th className="py-2 px-2">Message</th>
                    <th className="py-2 px-2 w-24">Utilisateur</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => {
                    const lc = levelConfig[log.level] ?? levelConfig.info;
                    return (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</td>
                        <td className="py-1.5 px-2">
                          <Badge variant="outline" className={cn('text-[9px]', lc.className)}>{lc.label}</Badge>
                        </td>
                        <td className="py-1.5 px-2"><Badge variant="outline" className="text-[9px]">{log.source}</Badge></td>
                        <td className="py-1.5 px-2 font-mono text-[11px] max-w-[400px] truncate">{log.message}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{log.user_name || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
  );
}