#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Auditing external dependencies...\n');

const criticalDeps = {
  'isolated-vm': { concern: 'Security-critical package for V8 isolation', minVersion: '4.0.0' },
  'nats': { concern: 'Network communication', minVersion: '2.0.0' },
  'next': { concern: 'Framework compatibility', minVersion: '13.0.0' },
  'react': { concern: 'Framework compatibility', minVersion: '18.0.0' },
  '@napi-rs/cli': { concern: 'Native module building', minVersion: '2.0.0' }
};

const warnings = [];

function checkDep(pkgName, depName, version) {
  if (criticalDeps[depName]) {
    const { concern, minVersion } = criticalDeps[depName];
    console.log(`📦 ${pkgName} uses ${depName}@${version} (${concern})`);
    
    // Simple version check (doesn't handle all semver complexities)
    const versionMatch = version.match(/(\d+)\.(\d+)\.(\d+)/);
    const minMatch = minVersion.match(/(\d+)\.(\d+)\.(\d+)/);
    
    if (versionMatch && minMatch) {
      const major = parseInt(versionMatch[1]);
      const minMajor = parseInt(minMatch[1]);
      
      if (major < minMajor) {
        warnings.push(`${pkgName}: ${depName}@${version} is below minimum ${minVersion}`);
      }
    }
  }
}

function auditPackage(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.private && !pkg.name.includes('@rizome/')) return;
  
  // Check dependencies
  if (pkg.dependencies) {
    for (const [dep, version] of Object.entries(pkg.dependencies)) {
      checkDep(pkg.name, dep, version);
    }
  }
  
  // Check devDependencies
  if (pkg.devDependencies) {
    for (const [dep, version] of Object.entries(pkg.devDependencies)) {
      checkDep(pkg.name, dep, version);
    }
  }
}

// Check all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    auditPackage(pkgPath);
  }
}

// Check napi-bridge
const napiBridgePath = path.join(__dirname, '..', 'runtimes', 'napi-bridge', 'package.json');
if (fs.existsSync(napiBridgePath)) {
  auditPackage(napiBridgePath);
}

console.log('\n' + '='.repeat(50));

if (warnings.length > 0) {
  console.error('\n⚠️  Dependency warnings:');
  warnings.forEach(warning => console.error('  ', warning));
} else {
  console.log('\n✅ All critical dependencies look good');
}

console.log('\n💡 Recommendations:');
console.log('  - Run "pnpm audit" for security vulnerabilities');
console.log('  - Consider adding "overrides" in root package.json for critical deps');
console.log('  - Enable Dependabot or similar for automated updates');