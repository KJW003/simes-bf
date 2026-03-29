import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuditReports, useSubmitAudit } from '@/hooks/useApi';
import {
  ShieldCheck, FileText, Loader2, Clock, ChevronRight, AlertTriangle, CheckCircle2, XCircle,
} from 'lucide-react';

function scoreColor(score: number) {
  if (score >= 85) return 'bg-green-100 text-green-700';
  if (score >= 70) return 'bg-emerald-100 text-emerald-700';
  if (score >= 50) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function statusBadge(status: string) {
  switch (status) {
    case 'ready':
      return <Badge className="bg-green-100 text-green-700 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Terminé</Badge>;
    case 'computing':
    case 'pending':
      return <Badge className="bg-blue-100 text-blue-700 text-[10px]"><Loader2 className="w-3 h-3 mr-1 animate-spin" />En cours</Badge>;
    case 'failed':
      return <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="w-3 h-3 mr-1" />Échoué</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
  }
}

export default function AuditHistory() {
  const { selectedTerrainId } = useAppContext();
  const navigate = useNavigate();
  const submitAudit = useSubmitAudit();

  const { data, isLoading, refetch } = useAuditReports(selectedTerrainId, { limit: 50 });
  const audits = data?.audits ?? [];

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Historique des audits" description="Sélectionnez un terrain" />
        <Card><CardContent className="py-12 text-center text-muted-foreground">Aucun terrain sélectionné</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Historique des audits"
        description="Rapports d'audit énergétique générés pour ce terrain"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/energy-audit')}>
              <ShieldCheck className="w-4 h-4 mr-2" />
              Audit live
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={submitAudit.isPending}
              onClick={async () => {
                if (!selectedTerrainId) return;
                try {
                  const res = await submitAudit.mutateAsync(selectedTerrainId);
                  navigate(`/audit-history/${res.audit_id}`);
                } catch { /* handled by mutation */ }
              }}
            >
              {submitAudit.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Nouvel audit
            </Button>
          </div>
        }
      />

      {isLoading && (
        <Card><CardContent className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      )}

      {!isLoading && audits.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShieldCheck className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun rapport d'audit généré pour ce terrain.</p>
            <p className="text-xs mt-1">Cliquez sur "Nouvel audit" pour en générer un.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && audits.length > 0 && (
        <div className="space-y-3">
          {audits.map((audit) => (
            <Card
              key={audit.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/audit-history/${audit.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Score badge */}
                    <div className="flex flex-col items-center">
                      <span className={`text-lg font-bold rounded-lg px-3 py-1 ${scoreColor(audit.efficiency_score)}`}>
                        {audit.status === 'ready' ? audit.efficiency_score : '—'}
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">
                        {audit.status === 'ready' ? audit.score_label : ''}
                      </span>
                    </div>

                    {/* Details */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          Audit du {new Date(audit.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                        {statusBadge(audit.status)}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(audit.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {audit.kpi && audit.status === 'ready' && (
                          <>
                            <span>{audit.kpi.points_count} points</span>
                            <span>{audit.kpi.readings_count} mesures</span>
                            {audit.kpi.energy_kwh > 0 && <span>{audit.kpi.energy_kwh.toFixed(1)} kWh</span>}
                          </>
                        )}
                        {audit.error && (
                          <span className="text-red-500 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />{audit.error}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
