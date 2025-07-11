#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📦 Adding prepublishOnly scripts to packages...\n');

function addPrepublishScript(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.private) return false; // Skip private packages
  
  // Check if it already has a prepublishOnly script
  if (pkg.scripts && pkg.scripts.prepublishOnly) {
    console.log(`✓ ${pkg.name} already has prepublishOnly script`);
    return false;
  }
  
  // Add prepublishOnly script
  if (!pkg.scripts) pkg.scripts = {};
  
  // For TypeScript packages, build before publish
  if (pkg.scripts.build) {
    pkg.scripts.prepublishOnly = 'pnpm run build';
  } else if (pkg.name === '@rizome/next-rc-native') {
    // Native package already has its own prepublishOnly
    return false;
  } else {
    console.warn(`⚠️  ${pkg.name} has no build script, skipping prepublishOnly`);
    return false;
  }
  
  // Write back
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Added prepublishOnly to ${pkg.name}`);
  return true;
}

let count = 0;

// Process all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    if (addPrepublishScript(pkgPath)) count++;
  }
}

console.log(`\n✅ Added prepublishOnly scripts to ${count} packages`);