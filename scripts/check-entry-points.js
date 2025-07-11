#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking package entry points...\n');

const issues = [];

function checkEntryPoints(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pkgDir = path.dirname(pkgPath);
  
  if (pkg.private) return; // Skip private packages
  
  // Check main entry point
  if (pkg.main) {
    const mainPath = path.join(pkgDir, pkg.main);
    if (!fs.existsSync(mainPath)) {
      issues.push(`${pkg.name}: main entry "${pkg.main}" not found`);
    } else {
      console.log(`✓ ${pkg.name}: main entry exists (${pkg.main})`);
    }
  } else {
    issues.push(`${pkg.name}: missing "main" field in package.json`);
  }
  
  // Check types entry point
  if (pkg.types || pkg.typings) {
    const typesField = pkg.types || pkg.typings;
    const typesPath = path.join(pkgDir, typesField);
    if (!fs.existsSync(typesPath)) {
      issues.push(`${pkg.name}: types entry "${typesField}" not found`);
    } else {
      console.log(`✓ ${pkg.name}: types entry exists (${typesField})`);
    }
  } else {
    // For TypeScript packages, this is important
    if (fs.existsSync(path.join(pkgDir, 'tsconfig.json'))) {
      issues.push(`${pkg.name}: missing "types" field in package.json`);
    }
  }
  
  // Check exports field if present
  if (pkg.exports) {
    if (typeof pkg.exports === 'string') {
      const exportPath = path.join(pkgDir, pkg.exports);
      if (!fs.existsSync(exportPath)) {
        issues.push(`${pkg.name}: export "${pkg.exports}" not found`);
      }
    } else if (pkg.exports['.']) {
      const exp = pkg.exports['.'];
      if (typeof exp === 'string') {
        const exportPath = path.join(pkgDir, exp);
        if (!fs.existsSync(exportPath)) {
          issues.push(`${pkg.name}: export "." "${exp}" not found`);
        }
      } else if (exp.import) {
        const importPath = path.join(pkgDir, exp.import);
        if (!fs.existsSync(importPath)) {
          issues.push(`${pkg.name}: export "." import "${exp.import}" not found`);
        }
      }
    }
  }
  
  // Check files field
  if (pkg.files) {
    // Check if required files are included in files array
    if (pkg.main && !pkg.files.some(f => pkg.main.startsWith(f.replace('**/*', '')))) {
      console.warn(`⚠️  ${pkg.name}: main entry "${pkg.main}" might not be included in files array`);
    }
  }
}

// Check all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    checkEntryPoints(pkgPath);
  }
}

// Check napi-bridge
const napiBridgePath = path.join(__dirname, '..', 'runtimes', 'napi-bridge', 'package.json');
if (fs.existsSync(napiBridgePath)) {
  checkEntryPoints(napiBridgePath);
}

console.log('');

if (issues.length > 0) {
  console.error('❌ Entry point issues:');
  issues.forEach(issue => console.error('  ', issue));
  process.exit(1);
} else {
  console.log('✅ All entry points verified');
}