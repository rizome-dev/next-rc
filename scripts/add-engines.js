#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Adding consistent engine requirements...\n');

function addEngines(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.private && !pkg.name.includes('@rizome/')) return false; // Skip truly private packages
  
  // Check if engines field exists
  if (!pkg.engines || !pkg.engines.node) {
    if (!pkg.engines) pkg.engines = {};
    pkg.engines.node = '>=18.0.0';
    
    // Write back
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Added engines to ${pkg.name}`);
    return true;
  }
  
  // Standardize format (some have ">= 18.0.0" with space)
  if (pkg.engines.node === '>= 18.0.0') {
    pkg.engines.node = '>=18.0.0';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Standardized engines format in ${pkg.name}`);
    return true;
  }
  
  return false;
}

let count = 0;

// Process all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    if (addEngines(pkgPath)) count++;
  }
}

console.log(`\n✅ Updated engine requirements in ${count} packages`);