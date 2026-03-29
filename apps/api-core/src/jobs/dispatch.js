const { telemetryQueue, aiQueue, reportsQueue } = require("./queues");
const JobTypes = require("./jobTypes");

function pickQueue(jobType) {
  switch (jobType) {
    case JobTypes.FORECAST:
    case JobTypes.FACTURE:
    case JobTypes.AUDIT_PV:
    case JobTypes.ROI:
      return aiQueue;
    case JobTypes.REPORT:
    case JobTypes.ENERGY_AUDIT:
      return reportsQueue;
    case JobTypes.SOLAR_SCENARIO:
      return aiQueue;
    default:
      return telemetryQueue;
  }
}

module.exports = { pickQueue, JobTypes };
