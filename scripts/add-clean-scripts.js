#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Packages to update
const packages = [
  'packages/core',
  'packages/types',
  'packages/v8-runtime',
  'packages/wasm-runtime',
  'packages/ebpf-runtime',
  'packages/lattice',
  'packages/next-integration',
  'packages/tests',
  'runtimes/napi-bridge',
  'examples/next'
];

function addCleanScript(packagePath) {
  const pkgJsonPath = path.join(packagePath, 'package.json');
  
  if (!fs.existsSync(pkgJsonPath)) {
    console.log(`Skipping ${packagePath} - no package.json found`);
    return;
  }
  
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  
  // Add clean script if it doesn't exist
  if (!pkg.scripts) {
    pkg.scripts = {};
  }
  
  if (!pkg.scripts.clean) {
    pkg.scripts.clean = 'rm -rf dist lib build .next coverage *.tsbuildinfo';
    
    // Write back
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Added clean script to ${packagePath}`);
  } else {
    console.log(`⏭️  ${packagePath} already has clean script`);
  }
}

console.log('Adding clean scripts to all packages...\n');

packages.forEach(pkg => {
  addCleanScript(pkg);
});

console.log('\n✅ Done! You can now run "pnpm clean" from the root.');