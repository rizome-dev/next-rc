#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📦 Fixing files field in packages to exclude tests...\n');

function fixFilesField(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (pkg.private) return false; // Skip private packages
  
  let modified = false;
  
  // Check if files field includes 'src'
  if (pkg.files && pkg.files.includes('src')) {
    // Remove 'src' and add more specific patterns
    const srcIndex = pkg.files.indexOf('src');
    pkg.files.splice(srcIndex, 1);
    
    // Don't add src files since we're publishing compiled dist only
    console.log(`✅ Removed 'src' from files field in ${pkg.name}`);
    modified = true;
  }
  
  // Ensure dist is included
  if (pkg.files && !pkg.files.includes('dist')) {
    pkg.files.unshift('dist');
    console.log(`✅ Added 'dist' to files field in ${pkg.name}`);
    modified = true;
  }
  
  // If no files field, create one
  if (!pkg.files) {
    pkg.files = ['dist', 'README.md', 'LICENSE*'];
    console.log(`✅ Added files field to ${pkg.name}`);
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  
  return modified;
}

let count = 0;

// Process all packages
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir);

for (const dir of packageDirs) {
  const pkgPath = path.join(packagesDir, dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    if (fixFilesField(pkgPath)) count++;
  }
}

console.log(`\n✅ Fixed files field in ${count} packages`);