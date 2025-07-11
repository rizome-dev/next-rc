#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Configuration
const REPO_URL = 'https://github.com/rizome-dev/next-rc';
const AUTHOR = 'Samuel Joseph Troyer <sam@rizome.dev>';
const LICENSE = 'MIT OR Apache-2.0';
const HOMEPAGE = 'https://github.com/rizome-dev/next-rc';

// Packages to update
const packages = [
  'packages/core',
  'packages/types',
  'packages/v8-runtime',
  'packages/wasm-runtime',
  'packages/ebpf-runtime',
  'packages/lattice',
  'packages/next-integration',
  'runtimes/napi-bridge'
];

// Keywords for each package
const packageKeywords = {
  'core': ['runtime', 'execution', 'controller', 'ai', 'agents', 'sandboxing'],
  'types': ['typescript', 'types', 'runtime', 'execution'],
  'v8-runtime': ['v8', 'isolates', 'javascript', 'runtime', 'sandboxing'],
  'wasm-runtime': ['webassembly', 'wasm', 'runtime', 'sandboxing'],
  'ebpf-runtime': ['ebpf', 'linux', 'runtime', 'low-latency'],
  'lattice': ['distributed', 'nats', 'mesh', 'orchestration'],
  'next-integration': ['nextjs', 'react', 'runtime', 'integration'],
  'napi-bridge': ['napi', 'rust', 'bindings', 'native']
};

// Files to include for each package type
const defaultFiles = ['dist', 'lib', 'src', 'README.md', 'LICENSE'];

function updatePackageJson(packagePath) {
  const pkgJsonPath = path.join(packagePath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  
  const packageName = path.basename(packagePath);
  
  // Add missing fields
  if (!pkg.repository) {
    pkg.repository = {
      type: 'git',
      url: `git+${REPO_URL}.git`,
      directory: packagePath
    };
  }
  
  if (!pkg.author) {
    pkg.author = AUTHOR;
  }
  
  if (!pkg.license) {
    pkg.license = LICENSE;
  }
  
  if (!pkg.homepage) {
    pkg.homepage = HOMEPAGE;
  }
  
  if (!pkg.bugs) {
    pkg.bugs = {
      url: `${REPO_URL}/issues`
    };
  }
  
  if (!pkg.keywords && packageKeywords[packageName]) {
    pkg.keywords = packageKeywords[packageName];
  }
  
  // Add files field if missing
  if (!pkg.files) {
    pkg.files = defaultFiles;
  }
  
  // Add publishConfig for scoped packages
  if (pkg.name.startsWith('@') && !pkg.publishConfig) {
    pkg.publishConfig = {
      access: 'public'
    };
  }
  
  // Write back
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated ${packagePath}/package.json`);
}

// Update root package.json
function updateRootPackage() {
  const pkgJsonPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  
  if (!pkg.repository) {
    pkg.repository = {
      type: 'git',
      url: `git+${REPO_URL}.git`
    };
  }
  
  if (!pkg.author) {
    pkg.author = AUTHOR;
  }
  
  if (!pkg.homepage) {
    pkg.homepage = HOMEPAGE;
  }
  
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('✅ Updated root package.json');
}

// Create LICENSE files if missing
function createLicenseFile() {
  const mitLicense = `MIT License

Copyright (c) 2024 Rizome Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

  const apacheLicense = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Copyright 2024 Rizome Labs, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.`;

  const dualLicenseNotice = `Licensed under either of

 * Apache License, Version 2.0
   (LICENSE-APACHE or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license
   (LICENSE-MIT or http://opensource.org/licenses/MIT)

at your option.`;

  // Create main LICENSE file with dual license notice
  fs.writeFileSync('LICENSE', dualLicenseNotice);
  fs.writeFileSync('LICENSE-MIT', mitLicense);
  fs.writeFileSync('LICENSE-APACHE', apacheLicense);
  console.log('✅ Created LICENSE files (dual-license: MIT OR Apache-2.0)');
  
  // Copy to each package
  packages.forEach(pkg => {
    ['LICENSE', 'LICENSE-MIT', 'LICENSE-APACHE'].forEach(file => {
      const licensePath = path.join(pkg, file);
      if (!fs.existsSync(licensePath)) {
        fs.copyFileSync(file, licensePath);
        console.log(`✅ Copied ${file} to ${pkg}`);
      }
    });
  });
}

// Main execution
console.log('🚀 Preparing packages for NPM publication...\n');

// Update root
updateRootPackage();

// Update each package
packages.forEach(pkg => {
  updatePackageJson(pkg);
});

// Create license files
createLicenseFile();

console.log('\n✅ All packages prepared for publication!');
console.log('\n📝 Next steps:');
console.log('1. Review all changes with: git diff');
console.log('2. Commit changes: git add . && git commit -m "chore: prepare packages for npm publication"');
console.log('3. Run tests: pnpm test');
console.log('4. Build all packages: pnpm build');
console.log('5. Publish to NPM: pnpm publish -r');
