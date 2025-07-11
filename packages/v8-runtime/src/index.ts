// Export the V8 runtime with fallback support
let V8Runtime: any;
let V8IsolatePool: any;

try {
  // Try to use the isolated-vm based implementation
  require('isolated-vm');
  const runtime = require('./runtime');
  V8Runtime = runtime.V8Runtime;
  V8IsolatePool = require('./isolate-pool').V8IsolatePool;
} catch (error) {
  // Fall back to Node.js vm based implementation
  console.warn('Using fallback V8 runtime (isolated-vm not available)');
  const FallbackV8Runtime = require('./fallback-runtime').FallbackV8Runtime;
  V8Runtime = FallbackV8Runtime;
  // Mock isolate pool for compatibility
  V8IsolatePool = class {
    initialize() { return Promise.resolve(); }
    acquire() { return { id: 'mock' }; }
    release() { return Promise.resolve(); }
  };
}

export { V8Runtime, V8IsolatePool };
export * from './types';