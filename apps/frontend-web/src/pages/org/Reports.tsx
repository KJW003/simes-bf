import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Download, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAppContext } from '@/contexts/AppContext';
import type { MeasurementPoint } from '@/types';

export default function Reports() {
  const { selectedTerrainId } = useAppContext();
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!selectedTerrainId) return;

    const fetchPoints = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/terrains/${selectedTerrainId}/overview`);
        if (res.ok && res.points) {
          setPoints(res.points);
        }
      } catch (e) {
        console.error("Failed to fetch points:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchPoints();
  }, [selectedTerrainId]);

  const handleExportExcel = async (pointId: string) => {
    try {
      setExportingId(pointId);
      const url = `/reports/point/${pointId}/excel?days=${days}`;
      
      // Create a temporary link and trigger download
      const response = await fetch(api.baseURL + url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Export failed: ${error.error || 'Unknown error'}`);
        return;
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `simes-point-${pointId}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Failed to export report. Please try again.");
    } finally {
      setExportingId(null);
    }
  };

  if (!selectedTerrainId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rapports" description="Rapports énergétiques périodiques" />
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
            <div className="text-muted-foreground">
              Veuillez sélectionner un terrain pour accéder aux rapports
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Rapports" 
        description="Exportez les données énergétiques de vos points de mesure en Excel"
      />

      {/* Export Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paramètres d'export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Plage temporelle (derniers X jours):</label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-3 py-2 border rounded-md text-sm"
            >
              <option value={7}>7 jours</option>
              <option value={30}>30 jours</option>
              <option value={90}>90 jours</option>
              <option value={365}>1 an</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Points List */}
      <Card>
        <CardHeader>
          <CardTitle>Points de mesure</CardTitle>
          <CardDescription>
            {points.length > 0 && `${points.length} point(s) disponible(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : points.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>Aucun point de mesure trouvé</p>
            </div>
          ) : (
            <div className="space-y-3">
              {points.map((point) => (
                <div
                  key={point.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <h4 className="font-medium">{point.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {point.measure_category || 'Non catégorisé'} • ID: {point.id}
                    </p>
                  </div>
                  <Button
                    onClick={() => handleExportExcel(point.id)}
                    disabled={exportingId === point.id}
                    size="sm"
                    className="gap-2"
                  >
                    {exportingId === point.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Export...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Excel
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}