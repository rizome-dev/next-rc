#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking TypeScript configurations...\n');

const issues = [];

function checkTsConfig(pkgName, dir) {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    issues.push(`${pkgName}: Missing tsconfig.json`);
    return;
  }
  
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  let compilerOptions = tsconfig.compilerOptions || {};
  
  // If extends is present, merge with parent config
  if (tsconfig.extends) {
    const parentPath = path.resolve(dir, tsconfig.extends);
    if (fs.existsSync(parentPath)) {
      const parentConfig = JSON.parse(fs.readFileSync(parentPath, 'utf8'));
      compilerOptions = { ...(parentConfig.compilerOptions || {}), ...compilerOptions };
    }
  }
  
  // Check critical settings for publishing
  if (!compilerOptions.declaration) {
    issues.push(`${pkgName}: Missing "declaration": true in tsconfig.json`);
  }
  
  if (!compilerOptions.declarationMap) {
    console.warn(`⚠️  ${pkgName}: Consider adding "declarationMap": true for better IDE support`);
  }
  
  if (compilerOptions.outDir !== 'dist' && compilerOptions.outDir !== './dist') {
    issues.push(`${pkgName}: outDir should be "dist" (found: ${compilerOptions.outDir})`);
  }
  
  // Check if dist exists and has files
  const distPath = path.join(dir, 'dist');
  if (!fs.existsSync(distPath)) {
    issues.push(`${pkgName}: dist directory doesn't exist - run build`);
  } else {
    const distFiles = fs.readdirSync(distPath);
    if (distFiles.length === 0) {
      issues.push(`${pkgName}: dist directory is empty`);
    } else {
      const hasJs = distFiles.some(f => f.endsWith('.js'));
      const hasDts = distFiles.some(f => f.endsWith('.d.ts'));
      
      if (!hasJs) issues.push(`${pkgName}: No .js files in dist`);
      if (!hasDts) issues.push(`${pkgName}: No .d.ts files in dist`);
    }
  }
}

// Check packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // Skip private packages
    if (!pkg.private) {
      checkTsConfig(pkg.name, path.join(packagesDir, dir));
    }
  }
}

if (issues.length > 0) {
  console.error('❌ TypeScript configuration issues:');
  issues.forEach(issue => console.error('  ', issue));
  process.exit(1);
} else {
  console.log('✅ All TypeScript configurations look good');
}