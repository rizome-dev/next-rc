#!/usr/bin/env node
// Integration test using native bindings directly
const native = require('../runtimes/napi-bridge');

// Enum values
const Language = { C: 5, Wasm: 7 };
const TrustLevel = { High: 2 };

async function testIntegration() {
  console.log('🚀 Testing Integration with Native Bindings\n');
  
  try {
    // Test WASM Runtime
    console.log('📋 Test 1: WASM Runtime');
    const wasmBridge = new native.WasmRuntimeBridge();
    await wasmBridge.initialize();
    console.log('✅ WASM runtime initialized');
    
    // Compile WAT code
    const watCode = `
      (module
        (func $add (param $a i32) (param $b i32) (result i32)
          local.get $a
          local.get $b
          i32.add)
        (export "_start" (func $add))
      )
    `;
    
    const wasmModuleId = await wasmBridge.compile(watCode, Language.Wasm);
    console.log('✅ WASM module compiled:', wasmModuleId);
    
    // Instantiate the module
    const wasmInstanceId = await wasmBridge.instantiate(wasmModuleId);
    console.log('✅ WASM instance created:', wasmInstanceId);
    
    // Execute the code
    const wasmResult = await wasmBridge.execute(wasmInstanceId, {
      timeoutMs: 1000,
      memoryLimitBytes: 1024 * 1024,
      trustLevel: TrustLevel.High,
      networkAccess: false,
      filesystemAccess: false
    });
    console.log('✅ WASM execution result:', wasmResult);
    
    // Get metrics
    const wasmMetrics = await wasmBridge.getPerformanceMetrics();
    console.log('📊 WASM metrics:', wasmMetrics);
    
    // Test eBPF Runtime
    console.log('\n📋 Test 2: eBPF Runtime (compile only)');
    const ebpfBridge = new native.EbpfRuntimeBridge();
    await ebpfBridge.initialize();
    console.log('✅ eBPF runtime initialized');
    
    // Compile simple eBPF code
    const ebpfCode = `
      int filter(void *ctx) {
        return 1; // Accept
      }
    `;
    
    const ebpfModuleId = await ebpfBridge.compile(ebpfCode, Language.C);
    console.log('✅ eBPF module compiled:', ebpfModuleId);
    
    // Load the program
    const ebpfInstanceId = await ebpfBridge.loadProgram(ebpfModuleId);
    console.log('✅ eBPF program loaded:', ebpfInstanceId);
    
    // Get runtime info
    console.log('\n📊 Runtime Information:');
    console.log('Available runtimes:', native.getAvailableRuntimes());
    console.log('Version:', native.getVersion());
    
    // Get runtime metrics
    const allMetrics = await native.getRuntimeMetrics();
    console.log('All runtime metrics:', allMetrics);
    
    console.log('\n✅ Integration tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testIntegration().then(() => {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});