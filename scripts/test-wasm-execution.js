#!/usr/bin/env node

// Test WASM runtime execution with actual code

const native = require('../runtimes/napi-bridge');

async function testWasmExecution() {
  console.log('🚀 Testing WASM Runtime Execution\n');
  
  try {
    // Initialize runtime controller
    native.initializeRuntimeController();
    
    // Create WASM runtime bridge
    const wasmBridge = new native.WasmRuntimeBridge();
    console.log('✅ WASM runtime bridge created');
    
    // Initialize the runtime
    await wasmBridge.initialize();
    console.log('✅ WASM runtime initialized');
    
    // Test 1: Simple Rust code that compiles to WASM
    console.log('\n--- Test 1: Simple Rust Addition ---');
    const rustCode = `
#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[no_mangle]
pub extern "C" fn main() -> i32 {
    add(5, 3)
}
`;
    
    const moduleId = await wasmBridge.compile(rustCode, native.Language.Rust);
    console.log('✅ Module compiled:', moduleId);
    
    const instanceId = await wasmBridge.instantiate(moduleId);
    console.log('✅ Instance created:', instanceId);
    
    const result = await wasmBridge.execute(instanceId, {
      timeoutMs: 5000,
      memoryLimitBytes: 128 * 1024 * 1024,
      trustLevel: native.TrustLevel.Medium,
      networkAccess: false,
      filesystemAccess: false
    });
    
    console.log('✅ Execution result:', result);
    
    await wasmBridge.destroy(instanceId);
    console.log('✅ Instance destroyed');
    
    // Test 2: JavaScript compiled to WASM (via AssemblyScript or similar)
    console.log('\n--- Test 2: JavaScript/TypeScript to WASM ---');
    const jsCode = `
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));
`;
    
    const jsModuleId = await wasmBridge.compile(jsCode, native.Language.JavaScript);
    console.log('✅ JS module compiled:', jsModuleId);
    
    const jsInstanceId = await wasmBridge.instantiate(jsModuleId);
    console.log('✅ JS instance created:', jsInstanceId);
    
    const jsResult = await wasmBridge.execute(jsInstanceId, {
      timeoutMs: 5000,
      memoryLimitBytes: 128 * 1024 * 1024,
      trustLevel: native.TrustLevel.Low,
      networkAccess: false,
      filesystemAccess: false
    });
    
    console.log('✅ JS execution result:', jsResult);
    
    await wasmBridge.destroy(jsInstanceId);
    console.log('✅ JS instance destroyed');
    
    // Test 3: Get runtime metrics
    console.log('\n--- Test 3: Runtime Metrics ---');
    const status = await wasmBridge.getStatus();
    console.log('Runtime status:', status);
    
    const metrics = await wasmBridge.getPerformanceMetrics();
    console.log('Performance metrics:', metrics);
    
    // Test runtime metrics function
    const allMetrics = await native.getRuntimeMetrics();
    console.log('\nAll runtime metrics:', allMetrics);
    
    console.log('\n🎉 All WASM execution tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
testWasmExecution().catch(console.error);