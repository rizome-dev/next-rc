#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function getPackages() {
  const packages = [];
  const packagesDir = path.join(__dirname, '..', 'packages');
  
  const dirs = fs.readdirSync(packagesDir);
  for (const dir of dirs) {
    const pkgPath = path.join(packagesDir, dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      packages.push({ name: pkg.name, dir, pkg, deps: {...(pkg.dependencies || {}), ...(pkg.peerDependencies || {})} });
    }
  }
  
  // Add napi-bridge
  const napiBridgePath = path.join(__dirname, '..', 'runtimes', 'napi-bridge', 'package.json');
  if (fs.existsSync(napiBridgePath)) {
    const pkg = JSON.parse(fs.readFileSync(napiBridgePath, 'utf8'));
    packages.push({ name: pkg.name, dir: 'runtimes/napi-bridge', pkg, deps: {...(pkg.dependencies || {}), ...(pkg.peerDependencies || {})} });
  }
  
  return packages;
}

function checkCircularDeps(packages) {
  const graph = {};
  const packageNames = packages.map(p => p.name);
  
  // Build dependency graph
  for (const pkg of packages) {
    graph[pkg.name] = [];
    for (const dep in pkg.deps) {
      if (packageNames.includes(dep)) {
        graph[pkg.name].push(dep);
      }
    }
  }
  
  // DFS to detect cycles
  function hasCycle(node, visited, recStack, path) {
    visited[node] = true;
    recStack[node] = true;
    path.push(node);
    
    for (const neighbor of graph[node] || []) {
      if (!visited[neighbor]) {
        if (hasCycle(neighbor, visited, recStack, path)) return true;
      } else if (recStack[neighbor]) {
        path.push(neighbor);
        return true;
      }
    }
    
    path.pop();
    recStack[node] = false;
    return false;
  }
  
  const cycles = [];
  for (const node of Object.keys(graph)) {
    const visited = {};
    const recStack = {};
    const path = [];
    if (hasCycle(node, visited, recStack, path)) {
      cycles.push(path.slice(path.indexOf(path[path.length - 1])));
    }
  }
  
  return cycles;
}

const packages = getPackages();
console.log('📦 Found packages:', packages.map(p => p.name).join(', '));

// Check circular dependencies
const cycles = checkCircularDeps(packages);
if (cycles.length > 0) {
  console.error('\n❌ Circular dependencies detected:');
  cycles.forEach(cycle => {
    console.error('  ', cycle.join(' → '));
  });
} else {
  console.log('\n✅ No circular dependencies found');
}

// Check dependency versions
console.log('\n🔍 Checking internal dependency versions:');
const issues = [];
for (const pkg of packages) {
  // Skip private packages - they can use workspace references
  if (pkg.pkg.private) continue;
  
  for (const [dep, version] of Object.entries(pkg.deps)) {
    if (dep.startsWith('@rizome/')) {
      if (version !== '^0.1.0') {
        issues.push(`${pkg.name} has ${dep}@${version} (should be ^0.1.0)`);
      }
    }
  }
}

if (issues.length > 0) {
  console.error('❌ Version mismatches:');
  issues.forEach(issue => console.error('  ', issue));
} else {
  console.log('✅ All internal dependencies use correct versions');
}

// Check for workspace: references
console.log('\n🔍 Checking for workspace references:');
const workspaceRefs = [];
for (const pkg of packages) {
  // Skip private packages - they can use workspace references
  if (pkg.pkg.private) continue;
  
  for (const [dep, version] of Object.entries(pkg.deps)) {
    if (version.includes('workspace:')) {
      workspaceRefs.push(`${pkg.name} has ${dep}@${version}`);
    }
  }
}

if (workspaceRefs.length > 0) {
  console.error('❌ Workspace references found (these will fail on npm publish):');
  workspaceRefs.forEach(ref => console.error('  ', ref));
} else {
  console.log('✅ No workspace references found');
}