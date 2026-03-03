const express = require('express');
const cors = require('cors');
const healthRoutes = require('./modules/health/health.routes');
const jobsRoutes = require("./modules/jobs/jobs.routes");
const runsRoutes = require("./modules/runs/runs.routes");
const referentialRoutes = require("./modules/referential/referential.routes");
const ingestionRoutes = require("./modules/ingestion/ingestion.routes");
const resultsRoutes = require("./modules/results/results.routes"); 
const tariffsRoutes = require("./modules/tariffs/tariffs.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const telemetryRoutes = require("./modules/telemetry/telemetry.routes");
// const testListenerRoutes = require("./modules/test-listener/test-listener.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', healthRoutes);
app.use("/", referentialRoutes);
app.use("/", jobsRoutes);
app.use("/", resultsRoutes);
app.use("/", tariffsRoutes);
app.use("/", adminRoutes);
app.use("/", telemetryRoutes);
//app.use("/", testListenerRoutes);
app.use("/runs", runsRoutes);
app.use("/ingest", ingestionRoutes);

module.exports = app;
