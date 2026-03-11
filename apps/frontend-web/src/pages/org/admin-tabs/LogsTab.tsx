// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB – Audit Logs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RefreshCw, ScrollText, Loader2 } from "lucide-react";
import { useLogs, useLogStats } from "@/hooks/useApi";

export default function LogsTab() {
  const [level, setLevel] = useState<string>('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const { data: logData, isLoading, refetch } = useLogs({ level: level || undefined, source: source || undefined, search: search || undefined, limit: 200 });
  const { data: statsData } = useLogStats();

  const logs = (logData as any)?.logs ?? [];
  const total = (logData as any)?.total ?? 0;
  const stats = (statsData as any)?.stats ?? [];

  const levelColor = (l: string) => {
    switch (l) {
      case 'error': return 'destructive' as const;
      case 'warn': return 'outline' as const;
      case 'info': return 'secondary' as const;
      default: return 'secondary' as const;
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['error', 'warn', 'info', 'debug'] as const).map(lvl => {
          const count = stats.find((s: any) => s.level === lvl)?.count ?? 0;
          return (
            <Card key={lvl} className="cursor-pointer hover:ring-1 ring-primary/30" onClick={() => setLevel(level === lvl ? '' : lvl)}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-sm capitalize font-medium">{lvl}</span>
                <Badge variant={levelColor(lvl)}>{count}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><ScrollText className="w-4 h-4" /> Logs ({total})</CardTitle>
            <Button size="sm" variant="outline" className="h-7" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Actualiser
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-3">
            <Select value={level} onValueChange={v => setLevel(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 w-28"><SelectValue placeholder="Niveau" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-8 w-40" placeholder="Source..." value={source} onChange={e => setSource(e.target.value)} />
            <Input className="h-8 flex-1 min-w-[150px]" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Aucun log trouvé</div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2 px-2">Niveau</th>
                    <th className="py-2 px-2">Source</th>
                    <th className="py-2 px-2">Message</th>
                    <th className="py-2 px-2">Utilisateur</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id} className="border-b text-xs hover:bg-muted/50">
                      <td className="py-1.5 px-2 whitespace-nowrap text-muted-foreground">{new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className="py-1.5 px-2"><Badge variant={levelColor(log.level)} className="text-[9px] px-1.5">{log.level}</Badge></td>
                      <td className="py-1.5 px-2 font-mono text-[10px]">{log.source ?? '—'}</td>
                      <td className="py-1.5 px-2 max-w-md truncate" title={log.message}>{log.message}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{log.user_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
