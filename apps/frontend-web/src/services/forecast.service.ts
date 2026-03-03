// ============================================================
// SIMES – Forecast Service
// ============================================================

import type { ForecastSummary } from '@/models/forecast.model';
import DataStore from './data-store';

class ForecastServiceImpl {
  getSummary(): ForecastSummary {
    return DataStore.getInstance().forecastSummary;
  }
}

export const ForecastService = new ForecastServiceImpl();
