// ============================================================
// Administration - Full CRUD admin panel (thin shell)
// Each tab is in its own file under ./admin-tabs/
// ============================================================

import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Building2, MapPin, Layers, Router, Cpu, MessageSquare, Users,
  Activity, Play, ScrollText,
} from "lucide-react";

import {
  TabErrorBoundary,
  ReferentialTab,
  GatewaysTab,
  DevicesTab,
  IncomingTab,
  MeasurementPointsTab,
  UsersTab,
  ZonesTab,
  PipelineTab,
  RunsTab,
  LogsTab,
} from "./admin-tabs";

export default function Administration() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Administration</h1>
      <Tabs defaultValue="referential">
        <TabsList>
          <TabsTrigger value="referential" className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Référentiel</TabsTrigger>
          <TabsTrigger value="gateways" className="flex items-center gap-1"><Router className="w-3.5 h-3.5" /> Concentrateurs</TabsTrigger>
          <TabsTrigger value="devices" className="flex items-center gap-1"><Cpu className="w-3.5 h-3.5" /> Appareils</TabsTrigger>
          <TabsTrigger value="points" className="flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Points de mesure</TabsTrigger>
          <TabsTrigger value="zones" className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Zones</TabsTrigger>
          <TabsTrigger value="incoming" className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Messages</TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Utilisateurs</TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> Pipeline</TabsTrigger>
          <TabsTrigger value="runs" className="flex items-center gap-1"><Play className="w-3.5 h-3.5" /> Jobs</TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-1"><ScrollText className="w-3.5 h-3.5" /> Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="referential"><TabErrorBoundary name="Référentiel"><ReferentialTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="gateways"><TabErrorBoundary name="Concentrateurs"><GatewaysTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="devices"><TabErrorBoundary name="Appareils"><DevicesTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="points"><TabErrorBoundary name="Points de mesure"><MeasurementPointsTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="zones"><TabErrorBoundary name="Zones"><ZonesTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="incoming"><TabErrorBoundary name="Messages"><IncomingTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="users"><TabErrorBoundary name="Utilisateurs"><UsersTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="pipeline"><TabErrorBoundary name="Pipeline"><PipelineTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="runs"><TabErrorBoundary name="Jobs"><RunsTab /></TabErrorBoundary></TabsContent>
        <TabsContent value="logs"><TabErrorBoundary name="Logs"><LogsTab /></TabErrorBoundary></TabsContent>
      </Tabs>
    </div>
  );
}