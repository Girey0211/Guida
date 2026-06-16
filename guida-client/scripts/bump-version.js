import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to the files relative to this script
const packageJsonPath = path.resolve(__dirname, '../package.json');
const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
const cargoTomlPath = path.resolve(__dirname, '../src-tauri/Cargo.toml');
const cargoLockPath = path.resolve(__dirname, '../src-tauri/Cargo.lock');
const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');

// Function to read and parse version
function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return pkg.version;
}

function bump(currentVersion, type) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format in package.json: ${currentVersion}`);
  }
  let [major, minor, patch] = parts;
  if (type === 'patch') {
    patch += 1;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new Error(`Invalid bump type: ${type}`);
  }
  return `${major}.${minor}.${patch}`;
}

function main() {
  const args = process.argv.slice(2);
  const currentVersion = getCurrentVersion();

  if (args.length === 0) {
    console.log(`Current version: ${currentVersion}`);
    console.log('\nUsage:');
    console.log('  npm run bump <version>  (e.g., npm run bump 0.2.5)');
    console.log('  npm run bump patch      (bumps patch version: 0.2.4 -> 0.2.5)');
    console.log('  npm run bump minor      (bumps minor version: 0.2.4 -> 0.3.0)');
    console.log('  npm run bump major      (bumps major version: 0.2.4 -> 1.0.0)');
    process.exit(0);
  }

  const input = args[0].toLowerCase();
  let newVersion;
  if (['patch', 'minor', 'major'].includes(input)) {
    newVersion = bump(currentVersion, input);
  } else {
    // Validate if it is a valid semver format
    if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(input)) {
      console.error(`Error: Invalid version format "${args[0]}". Must be x.y.z or patch/minor/major.`);
      process.exit(1);
    }
    newVersion = args[0];
  }

  console.log(`Bumping version from ${currentVersion} to ${newVersion}...`);

  // 1. Update package.json
  const pkgContent = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(pkgContent);
  pkg.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json -> ${newVersion}`);

  // 2. Update tauri.conf.json
  if (fs.existsSync(tauriConfPath)) {
    const tauriConfContent = fs.readFileSync(tauriConfPath, 'utf8');
    const tauriConf = JSON.parse(tauriConfContent);
    tauriConf.version = newVersion;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
    console.log(`Updated tauri.conf.json -> ${newVersion}`);
  }

  // 3. Update Cargo.toml
  if (fs.existsSync(cargoTomlPath)) {
    const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');
    // We replace version = "..." under [package]
    const newCargoContent = cargoContent.replace(/(^version\s*=\s*")[^"]*(")/m, `$1${newVersion}$2`);
    fs.writeFileSync(cargoTomlPath, newCargoContent, 'utf8');
    console.log(`Updated Cargo.toml -> ${newVersion}`);
  }

  // 4. Update Cargo.lock (only the [[package]] entry for "guida")
  if (fs.existsSync(cargoLockPath)) {
    const lockContent = fs.readFileSync(cargoLockPath, 'utf8');
    // Match the guida package block and replace its version line only
    const newLockContent = lockContent.replace(
      /(\[\[package\]\]\r?\nname = "guida"\r?\nversion = ")[^"]*(")/,
      `$1${newVersion}$2`
    );
    if (newLockContent !== lockContent) {
      fs.writeFileSync(cargoLockPath, newLockContent, 'utf8');
      console.log(`Updated Cargo.lock -> ${newVersion}`);
    } else {
      console.warn('Warning: could not find "guida" package entry in Cargo.lock; skipped.');
    }
  }

  // 5. Update CHANGELOG.md
  if (fs.existsSync(changelogPath)) {
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    const versionRegex = new RegExp(`##\\s*\\[?${newVersion.replace(/\./g, '\\.')}\\]?`);
    if (!versionRegex.test(changelogContent)) {
      const today = new Date().toISOString().split('T')[0];
      const newHeader = `## [${newVersion}] - ${today}\n### Added\n- \n\n`;
      
      const match = changelogContent.match(/(# Changelog\r?\n\r?(?:All notable changes to this project will be documented in this file\.)?\r?\n\r?)/);
      let newChangelog;
      if (match) {
        newChangelog = changelogContent.replace(match[0], `${match[0]}${newHeader}`);
      } else {
        const firstHeaderIndex = changelogContent.indexOf('## ');
        if (firstHeaderIndex !== -1) {
          newChangelog = changelogContent.slice(0, firstHeaderIndex) + newHeader + changelogContent.slice(firstHeaderIndex);
        } else {
          newChangelog = changelogContent + `\n${newHeader}`;
        }
      }
      fs.writeFileSync(changelogPath, newChangelog, 'utf8');
      console.log(`Updated CHANGELOG.md -> Added header for ${newVersion}`);
    } else {
      console.log(`CHANGELOG.md already has header for ${newVersion}; skipped.`);
    }
  }

  console.log('Successfully updated all version fields!');
}

main();
