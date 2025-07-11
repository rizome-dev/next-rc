#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Preparing packages for NPM publication...\n');

const packages = [
  'packages/core',
  'packages/v8-runtime', 
  'packages/wasm-runtime',
  'packages/ebpf-runtime',
  'packages/python-runtime',
  'packages/lattice',
  'packages/next-integration',
  'packages/types',
  'runtimes/napi-bridge'
];

// Check current state
console.log('Checking current dependency state...');
const corePackageJson = path.join(__dirname, '..', 'packages/core/package.json');
const corePkg = JSON.parse(fs.readFileSync(corePackageJson, 'utf8'));
const hasWorkspaceRefs = corePkg.dependencies['@rizome/next-rc-types'] === 'workspace:*';

if (!hasWorkspaceRefs) {
  console.log('\n⚠️  Packages already have version numbers instead of workspace references.');
  console.log('This means we cannot use pnpm install/build commands.');
  console.log('\nYou have two options:');
  console.log('\nOption 1: If packages are already built:');
  console.log('  1. npm login');
  console.log('  2. Follow the publishing order in NPM-PUBLISHING.md');
  console.log('\nOption 2: If you need to rebuild:');
  console.log('  1. Run: node scripts/fix-workspace-deps.js');
  console.log('  2. Run: pnpm install');
  console.log('  3. Run: pnpm build');
  console.log('  4. Run this script again');
  process.exit(0);
}

console.log('✅ Currently using workspace references (good for building)\n');

// Install and build with workspace references
try {
  console.log('Step 1: Installing dependencies...');
  execSync('pnpm install', { stdio: 'inherit' });
  
  console.log('\nStep 2: Cleaning previous builds...');
  execSync('pnpm clean', { stdio: 'inherit' });
  
  console.log('\nStep 3: Building all packages...');
  execSync('pnpm build', { stdio: 'inherit' });
  
  // Build native module
  console.log('\nStep 4: Building native module...');
  execSync('cd runtimes/napi-bridge && pnpm build', { stdio: 'inherit', shell: true });
  
} catch (error) {
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}

// Now change to version numbers
console.log('\nStep 5: Changing to version numbers for NPM...');

packages.forEach(pkgDir => {
  const pkgPath = path.join(__dirname, '..', pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let modified = false;
  
  // Skip private packages
  if (pkg.private) return;
  
  // Fix dependencies
  if (pkg.dependencies) {
    Object.keys(pkg.dependencies).forEach(dep => {
      if (dep.startsWith('@rizome/') && pkg.dependencies[dep] === 'workspace:*') {
        pkg.dependencies[dep] = '^0.1.0';
        modified = true;
      }
    });
  }
  
  if (modified) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Updated ${pkg.name} to use version numbers`);
  }
});

console.log('\n' + '='.repeat(60));
console.log('✅ All packages are built and ready for NPM publication!');
console.log('='.repeat(60));
console.log('\n⚠️  IMPORTANT: Do NOT run any pnpm commands now!');
console.log('   The packages reference each other with version numbers');
console.log('   that don\'t exist on NPM yet.');
console.log('\nNext steps:');
console.log('1. npm login');
console.log('2. Publish packages in this order:');
console.log('   - cd packages/types && npm publish --access public');
console.log('   - cd ../../runtimes/napi-bridge && npm publish --access public');
console.log('   - cd ../../packages/v8-runtime && npm publish --access public');
console.log('   - cd ../wasm-runtime && npm publish --access public');
console.log('   - cd ../ebpf-runtime && npm publish --access public');
console.log('   - cd ../python-runtime && npm publish --access public');
console.log('   - cd ../lattice && npm publish --access public');
console.log('   - cd ../core && npm publish --access public');
console.log('   - cd ../next-integration && npm publish --access public');
console.log('\n🎉 Good luck with your first NPM release!');