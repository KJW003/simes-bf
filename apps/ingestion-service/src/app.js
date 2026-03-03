const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/health.routes");
const ingestionRoutes = require("./routes/ingestion.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", healthRoutes);
app.use("/", ingestionRoutes);

module.exports = app;
