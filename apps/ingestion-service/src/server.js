const app = require("./app");
const { port } = require("./config/env");

app.listen(port, () => {
  console.log(`Ingestion service running on port ${port}`);
});
