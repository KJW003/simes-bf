// ============================================================
// SIMES – Invoice Service
// ============================================================

import type { InvoiceEstimate } from '@/models/invoice.model';
import DataStore from './data-store';

class InvoiceServiceImpl {
  getEstimate(): InvoiceEstimate {
    return DataStore.getInstance().invoiceEstimate;
  }
}

export const InvoiceService = new InvoiceServiceImpl();
