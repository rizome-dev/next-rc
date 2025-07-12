#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node update-versions.js <version>');
  process.exit(1);
}

console.log(`Updating all packages to version ${version}...`);

// List of all packages to update
const packages = [
  'package.json', // root
  'packages/core/package.json',
  'packages/types/package.json',
  'packages/v8-runtime/package.json',
  'packages/wasm-runtime/package.json',
  'packages/ebpf-runtime/package.json',
  'packages/python-runtime/package.json',
  'packages/lattice/package.json',
  'packages/next-integration/package.json',
  'runtimes/napi-bridge/package.json',
  // Platform packages
  'runtimes/napi-bridge/npm/darwin-arm64/package.json',
  'runtimes/napi-bridge/npm/darwin-x64/package.json',
  'runtimes/napi-bridge/npm/linux-x64-gnu/package.json',
  'runtimes/napi-bridge/npm/linux-arm64-gnu/package.json',
  'runtimes/napi-bridge/npm/win32-x64-msvc/package.json',
];

// Also update workspace dependencies
const workspacePackages = [
  '@rizome/next-rc-types',
  '@rizome/next-rc-core',
  '@rizome/next-rc-v8',
  '@rizome/next-rc-wasm',
  '@rizome/next-rc-ebpf',
  '@rizome/next-rc-python',
  '@rizome/next-rc-lattice',
  '@rizome/next-rc',
  '@rizome/next-rc-native',
];

packages.forEach(packagePath => {
  const fullPath = path.join(__dirname, '..', packagePath);
  
  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  Skipping ${packagePath} - file not found`);
    return;
  }
  
  const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const oldVersion = pkg.version;
  pkg.version = version;
  
  // Update workspace dependencies
  if (pkg.dependencies) {
    Object.keys(pkg.dependencies).forEach(dep => {
      if (workspacePackages.includes(dep) && pkg.dependencies[dep] === 'workspace:*') {
        // Keep workspace protocol for local development
        // NPM will resolve these during publish
      }
    });
  }
  
  if (pkg.devDependencies) {
    Object.keys(pkg.devDependencies).forEach(dep => {
      if (workspacePackages.includes(dep) && pkg.devDependencies[dep] === 'workspace:*') {
        // Keep workspace protocol
      }
    });
  }
  
  // Update optionalDependencies for native package
  if (pkg.name === '@rizome/next-rc-native' && pkg.optionalDependencies) {
    Object.keys(pkg.optionalDependencies).forEach(dep => {
      if (dep.startsWith('@rizome/next-rc-')) {
        pkg.optionalDependencies[dep] = version;
      }
    });
  }
  
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated ${packagePath}: ${oldVersion} → ${version}`);
});

console.log('\n✨ All packages updated successfully!');