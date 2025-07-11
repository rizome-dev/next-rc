#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Reverting to workspace dependencies for local development...\n');

const packages = [
  'packages/core',
  'packages/v8-runtime', 
  'packages/wasm-runtime',
  'packages/ebpf-runtime',
  'packages/python-runtime',
  'packages/lattice',
  'packages/next-integration',
  'packages/types'
];

let fixed = 0;

packages.forEach(pkgDir => {
  const pkgPath = path.join(__dirname, '..', pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let modified = false;
  
  // Fix dependencies
  if (pkg.dependencies) {
    Object.keys(pkg.dependencies).forEach(dep => {
      if (dep.startsWith('@rizome/') && pkg.dependencies[dep] === '^0.1.0') {
        pkg.dependencies[dep] = 'workspace:*';
        modified = true;
      }
    });
  }
  
  // Fix devDependencies
  if (pkg.devDependencies) {
    Object.keys(pkg.devDependencies).forEach(dep => {
      if (dep.startsWith('@rizome/') && pkg.devDependencies[dep] === '^0.1.0') {
        pkg.devDependencies[dep] = 'workspace:*';
        modified = true;
      }
    });
  }
  
  if (modified) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Fixed ${pkg.name}`);
    fixed++;
  }
});

console.log(`\n✅ Fixed ${fixed} packages to use workspace references`);
console.log('\nNOTE: Remember to change these back to version numbers before publishing to NPM!');