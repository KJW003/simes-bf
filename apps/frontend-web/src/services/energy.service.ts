// ============================================================
// SIMES – Energy Service (PV audits)
// ============================================================

import type { PvAudit } from '@/models/energy.model';
import DataStore from './data-store';

class EnergyServiceImpl {
  getPvAudit(): PvAudit {
    return DataStore.getInstance().pvAudit;
  }
}

export const EnergyService = new EnergyServiceImpl();
