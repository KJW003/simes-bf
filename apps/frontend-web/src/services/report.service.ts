// ============================================================
// SIMES – Report Service
// ============================================================

import type { Report } from '@/models/report.model';
import type { IQueryService } from './interfaces';
import DataStore from './data-store';

class ReportServiceImpl implements IQueryService<Report> {
  private get data() { return DataStore.getInstance().reports; }

  getAll(): Report[] { return this.data; }
  getById(id: string): Report | undefined { return this.data.find(r => r.id === id); }
  findBy(predicate: (r: Report) => boolean): Report[] { return this.data.filter(predicate); }
  findOneBy(predicate: (r: Report) => boolean): Report | undefined { return this.data.find(predicate); }
}

export const ReportService = new ReportServiceImpl();
