#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking dependency version ranges...\n');

const issues = [];

function checkVersionRange(version, depName, pkgName) {
  // Check for exact versions (no range specifier)
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    issues.push(`${pkgName}: ${depName}@${version} uses exact version (consider using ^)`);
  }
  
  // Check for wildcards
  if (version === '*' || version === 'latest') {
    issues.push(`${pkgName}: ${depName}@${version} uses wildcard (too permissive)`);
  }
  
  // Check for local file paths
  if (version.startsWith('file:') || version.startsWith('/') || version.startsWith('./')) {
    issues.push(`${pkgName}: ${depName}@${version} uses local file path`);
  }
  
  // Check for git URLs
  if (version.includes('git://') || version.includes('git+')) {
    issues.push(`${pkgName}: ${depName}@${version} uses git URL`);
  }
}

function checkPackage(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.private) return; // Skip private packages
  
  // Check dependencies
  if (pkg.dependencies) {
    for (const [dep, version] of Object.entries(pkg.dependencies)) {
      checkVersionRange(version, dep, pkg.name);
    }
  }
  
  // Check peerDependencies
  if (pkg.peerDependencies) {
    for (const [dep, version] of Object.entries(pkg.peerDependencies)) {
      // Peer deps can be more flexible
      if (version === '*') {
        issues.push(`${pkg.name}: ${dep}@${version} in peerDependencies (too permissive)`);
      }
    }
  }
  
  // Check devDependencies (less critical but still worth checking)
  if (pkg.devDependencies) {
    for (const [dep, version] of Object.entries(pkg.devDependencies)) {
      if (version.startsWith('file:') || version.includes('git://')) {
        issues.push(`${pkg.name}: ${dep}@${version} in devDependencies uses non-registry source`);
      }
    }
  }
  
  // Check engine requirements
  if (pkg.engines && pkg.engines.node) {
    const nodeReq = pkg.engines.node;
    if (!nodeReq.includes('>=') && !nodeReq.includes('^')) {
      console.warn(`⚠️  ${pkg.name}: Consider using >= for node engine requirement (found: ${nodeReq})`);
    }
  }
}

// Check all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    checkPackage(pkgPath);
  }
}

// Check napi-bridge
const napiBridgePath = path.join(__dirname, '..', 'runtimes', 'napi-bridge', 'package.json');
if (fs.existsSync(napiBridgePath)) {
  checkPackage(napiBridgePath);
}

if (issues.length > 0) {
  console.error('❌ Version range issues:');
  issues.forEach(issue => console.error('  ', issue));
  process.exit(1);
} else {
  console.log('✅ All dependency version ranges look good');
}