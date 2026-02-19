const express = require("express");
const app = express();

app.get("/health", (req, res) => {
  res.json({ status: "API CORE OK" });
});

app.listen(3000, () => {
  console.log("API Core running on port 3000");
});
