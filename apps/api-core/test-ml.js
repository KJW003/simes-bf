const http = require('node:http');
const https = require('node:https');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';

async function testFetch(url) {
  console.log(`\n--- Testing ${url} ---`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${text.substring(0, 200)}`);
  } catch (err) {
    console.error(`Fetch failed: ${err.message}`);
  }
}

async function run() {
  await testFetch(`${ML_SERVICE_URL}/health`);
  await testFetch(`${ML_SERVICE_URL}/forecast/daily-chart/abf6ad9a-2447-43eb-a4de-e99bf49765b7`);
}

run();