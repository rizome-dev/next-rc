#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 FINAL PUBLICATION READINESS CHECK');
console.log('=====================================\n');

const issues = [];
const warnings = [];
const success = [];

// Color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Packages to check
const packages = [
  { dir: 'packages/types', name: '@rizome/next-rc-types' },
  { dir: 'packages/core', name: '@rizome/next-rc-core' },
  { dir: 'packages/v8-runtime', name: '@rizome/next-rc-v8' },
  { dir: 'packages/wasm-runtime', name: '@rizome/next-rc-wasm' },
  { dir: 'packages/ebpf-runtime', name: '@rizome/next-rc-ebpf' },
  { dir: 'packages/python-runtime', name: '@rizome/next-rc-python' },
  { dir: 'packages/lattice', name: '@rizome/next-rc-lattice' },
  { dir: 'packages/next-integration', name: '@rizome/next-rc-integration' },
  { dir: 'runtimes/napi-bridge', name: '@rizome/next-rc-native' }
];

console.log('1️⃣  Checking package.json configurations...');
packages.forEach(({ dir, name }) => {
  const pkgPath = path.join(__dirname, '..', dir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    
    // Check required fields
    if (!pkg.name) issues.push(`${name}: Missing package name`);
    if (!pkg.version) issues.push(`${name}: Missing version`);
    if (!pkg.description) issues.push(`${name}: Missing description`);
    if (!pkg.main) issues.push(`${name}: Missing main entry point`);
    if (!pkg.author) issues.push(`${name}: Missing author`);
    if (!pkg.license) issues.push(`${name}: Missing license`);
    if (!pkg.repository) warnings.push(`${name}: Missing repository field`);
    if (!pkg.publishConfig?.access) issues.push(`${name}: Missing publishConfig.access`);
    
    // Check version
    if (pkg.version !== '0.1.0') warnings.push(`${name}: Version is ${pkg.version}, expected 0.1.0`);
    
    // Check dependencies are version numbers, not workspace refs
    if (pkg.dependencies) {
      Object.entries(pkg.dependencies).forEach(([dep, ver]) => {
        if (dep.startsWith('@rizome/') && ver === 'workspace:*') {
          issues.push(`${name}: Has workspace reference for ${dep}`);
        }
      });
    }
    
    success.push(`${name}: package.json valid`);
  } catch (e) {
    issues.push(`${name}: Failed to read package.json`);
  }
});

console.log('\n2️⃣  Checking build outputs...');
packages.forEach(({ dir, name }) => {
  const pkgPath = path.join(__dirname, '..', dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.main) {
    const mainPath = path.join(__dirname, '..', dir, pkg.main);
    if (!fs.existsSync(mainPath)) {
      issues.push(`${name}: Main entry ${pkg.main} not found`);
    } else {
      success.push(`${name}: Main entry exists`);
    }
  }
  
  if (pkg.types) {
    const typesPath = path.join(__dirname, '..', dir, pkg.types);
    if (!fs.existsSync(typesPath)) {
      warnings.push(`${name}: Types entry ${pkg.types} not found`);
    }
  }
});

console.log('\n3️⃣  Checking for sensitive files...');
const sensitivePatterns = ['.env', 'secret', 'password', 'key', 'token'];
let foundSensitive = false;
try {
  const gitFiles = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  gitFiles.forEach(file => {
    sensitivePatterns.forEach(pattern => {
      if (file.toLowerCase().includes(pattern) && !file.includes('package.json')) {
        issues.push(`Sensitive file pattern: ${file}`);
        foundSensitive = true;
      }
    });
  });
  if (!foundSensitive) success.push('No sensitive files detected');
} catch (e) {
  warnings.push('Could not check git files');
}

console.log('\n4️⃣  Checking README files...');
packages.forEach(({ dir, name }) => {
  const readmePath = path.join(__dirname, '..', dir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    warnings.push(`${name}: Missing README.md`);
  } else {
    success.push(`${name}: Has README.md`);
  }
});

console.log('\n5️⃣  Checking licenses...');
const rootLicense = path.join(__dirname, '..', 'LICENSE');
if (!fs.existsSync(rootLicense)) {
  issues.push('Missing root LICENSE file');
} else {
  success.push('Root LICENSE exists');
}

console.log('\n6️⃣  Checking .gitignore...');
const gitignorePath = path.join(__dirname, '..', '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = ['node_modules', '.env', 'dist/', '*.log'];
  requiredPatterns.forEach(pattern => {
    if (!gitignore.includes(pattern)) {
      warnings.push(`.gitignore missing pattern: ${pattern}`);
    }
  });
  success.push('.gitignore properly configured');
}

console.log('\n7️⃣  Checking npm credentials...');
try {
  execSync('npm whoami', { stdio: 'pipe' });
  success.push('NPM login verified');
} catch (e) {
  warnings.push('Not logged in to NPM (run: npm login)');
}

console.log('\n8️⃣  Final dependency check...');
const corePackage = path.join(__dirname, '..', 'packages/core/package.json');
const corePkg = JSON.parse(fs.readFileSync(corePackage, 'utf8'));
if (corePkg.dependencies['@rizome/next-rc-types'] === '^0.1.0') {
  success.push('Dependencies use version numbers (ready for NPM)');
} else if (corePkg.dependencies['@rizome/next-rc-types'] === 'workspace:*') {
  issues.push('Dependencies still use workspace references - run prepare-for-publish.js');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));

if (success.length > 0) {
  console.log(`\n${GREEN}✅ Passed Checks (${success.length}):${RESET}`);
  success.forEach(s => console.log(`   ${GREEN}✓${RESET} ${s}`));
}

if (warnings.length > 0) {
  console.log(`\n${YELLOW}⚠️  Warnings (${warnings.length}):${RESET}`);
  warnings.forEach(w => console.log(`   ${YELLOW}!${RESET} ${w}`));
}

if (issues.length > 0) {
  console.log(`\n${RED}❌ Issues (${issues.length}):${RESET}`);
  issues.forEach(i => console.log(`   ${RED}✗${RESET} ${i}`));
}

console.log('\n' + '='.repeat(60));

if (issues.length === 0) {
  console.log(`${GREEN}✅ READY FOR PUBLICATION!${RESET}\n`);
  console.log('GitHub: Push to your repository');
  console.log('NPM: Follow the publishing order in NPM-PUBLISHING.md');
  console.log('\nPublishing order:');
  console.log('1. packages/types');
  console.log('2. runtimes/napi-bridge');
  console.log('3. packages/v8-runtime');
  console.log('4. packages/wasm-runtime');
  console.log('5. packages/ebpf-runtime');
  console.log('6. packages/python-runtime');
  console.log('7. packages/lattice');
  console.log('8. packages/core');
  console.log('9. packages/next-integration');
} else {
  console.log(`${RED}❌ NOT READY - Fix ${issues.length} issues first${RESET}`);
  process.exit(1);
}