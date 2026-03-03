// ============================================================
// SIMES – Incident Service (NOC)
// ============================================================

import type { Incident } from '@/models/incident.model';
import type { PipelineHealth } from '@/models/incident.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class IncidentServiceImpl implements IQueryService<Incident> {
  private get data() { return DataStore.getInstance().incidents; }

  getAll(): Incident[] { return this.data; }
  getById(id: string): Incident | undefined { return this.data.find(i => i.id === id); }
  findBy(predicate: (i: Incident) => boolean): Incident[] { return this.data.filter(predicate); }
  findOneBy(predicate: (i: Incident) => boolean): Incident | undefined { return this.data.find(predicate); }

  getPipelineHealth(): PipelineHealth[] {
    return DataStore.getInstance().pipelineHealth;
  }
}

export const IncidentService = new IncidentServiceImpl();
