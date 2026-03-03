import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md", ".html"]);

const suspectRegex = /Ã|Â|â€™|â€œ|â€�|â€“|â€”|â€¢|â€¦|\uFFFD/;
const questionBetweenLetters = /[A-Za-zÀ-ÿ]\?[A-Za-zÀ-ÿ]/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
let issues = 0;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  if (!suspectRegex.test(content) && !questionBetweenLetters.test(content)) {
    continue;
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (suspectRegex.test(line) || questionBetweenLetters.test(line)) {
      issues += 1;
      console.log(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line}`);
    }
  });
}

if (issues > 0) {
  console.error(`\nFound ${issues} potential UTF-8 issues.`);
  process.exit(1);
}

console.log("No UTF-8 issues detected.");
