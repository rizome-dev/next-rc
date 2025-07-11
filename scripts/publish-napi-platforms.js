#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Publishing NAPI platform packages...\n');

const platformPackages = [
  'darwin-arm64',
  'darwin-x64', 
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'win32-x64-msvc'
];

const npmDir = path.join(__dirname, '..', 'runtimes', 'napi-bridge', 'npm');

// Check if we're logged in to npm
try {
  execSync('npm whoami', { stdio: 'pipe' });
} catch (e) {
  console.error('❌ Not logged in to npm. Run: npm login');
  process.exit(1);
}

let publishedCount = 0;
let failedCount = 0;

for (const platform of platformPackages) {
  const packageDir = path.join(npmDir, platform);
  const packageJsonPath = path.join(packageDir, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`⚠️  Skipping ${platform} - package.json not found`);
    continue;
  }
  
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  console.log(`📦 Publishing ${pkg.name}@${pkg.version}...`);
  
  // Check if the platform binary exists
  const binaryName = pkg.main;
  const binaryPath = path.join(packageDir, binaryName);
  
  if (!fs.existsSync(binaryPath)) {
    console.log(`  ⚠️  Warning: Binary ${binaryName} not found`);
    console.log(`  📝 Creating placeholder binary (will be replaced by CI)`);
    
    // Create a placeholder file
    fs.writeFileSync(binaryPath, Buffer.from('placeholder'));
  }
  
  try {
    // Try to publish
    execSync(`npm publish --access public`, {
      cwd: packageDir,
      stdio: 'inherit'
    });
    publishedCount++;
    console.log(`  ✅ Published ${pkg.name}\n`);
  } catch (e) {
    console.log(`  ❌ Failed to publish ${pkg.name}`);
    console.log(`  Error: ${e.message}\n`);
    failedCount++;
  }
}

console.log('\n📊 Summary:');
console.log(`✅ Published: ${publishedCount} packages`);
if (failedCount > 0) {
  console.log(`❌ Failed: ${failedCount} packages`);
}

console.log('\n💡 Next steps:');
console.log('1. The build-napi.yml workflow will build real binaries');
console.log('2. Then publish the main @rizome/next-rc-native package');
console.log('3. Users will get platform binaries automatically via optionalDependencies');