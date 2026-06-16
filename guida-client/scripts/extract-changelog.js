import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CHANGELOG.md path is at client root
const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node extract-changelog.js <version>');
    process.exit(1);
  }

  const version = args[0].replace(/^v/, ''); // strip leading 'v'
  
  if (!fs.existsSync(changelogPath)) {
    console.error(`Error: CHANGELOG.md not found at ${changelogPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  const lines = content.split(/\r?\n/);

  let startIndex = -1;
  let endIndex = -1;

  // Pattern to match version header: "## [version]" or "## version"
  // E.g., "## [0.3.2] - 2026-06-16" or "## 0.3.2"
  const versionRegex = new RegExp(`^##\\s*\\[?${version.replace(/\./g, '\\.')}\\]?(\\s+|$)`);

  for (let i = 0; i < lines.length; i++) {
    if (versionRegex.test(lines[i])) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    console.error(`Error: Version ${version} not found in CHANGELOG.md`);
    process.exit(1);
  }

  // Find the end of this version's section (next header starting with ##)
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  const targetLines = endIndex === -1 ? lines.slice(startIndex + 1) : lines.slice(startIndex + 1, endIndex);
  const result = targetLines.join('\n').trim();

  if (!result) {
    console.warn(`Warning: Changelog body for version ${version} is empty.`);
  }

  console.log(result);
}

main();
