#!/usr/bin/env node

// Test script to verify native bindings are working

try {
  console.log('Testing native NAPI bindings...\n');
  
  const native = require('../runtimes/napi-bridge');
  
  console.log('✅ Native bindings loaded successfully!');
  console.log('\nAvailable exports:', Object.keys(native));
  
  // Test basic functions
  console.log('\n--- Testing basic functions ---');
  console.log('Version:', native.getVersion());
  console.log('Available runtimes:', native.getAvailableRuntimes());
  
  // Test runtime initialization
  console.log('\n--- Testing runtime initialization ---');
  native.initializeRuntimeController();
  console.log('✅ Runtime controller initialized');
  
  // Test WASM runtime
  console.log('\n--- Testing WASM Runtime Bridge ---');
  const wasmBridge = new native.WasmRuntimeBridge();
  console.log('✅ WASM runtime bridge created');
  
  // Test eBPF runtime
  console.log('\n--- Testing eBPF Runtime Bridge ---');
  const ebpfBridge = new native.EbpfRuntimeBridge();
  console.log('✅ eBPF runtime bridge created');
  
  // Test enums
  console.log('\n--- Testing Enums ---');
  console.log('Languages:', native.Language);
  console.log('Trust levels:', native.TrustLevel);
  
  console.log('\n🎉 All tests passed! Native bindings are working correctly.');
  
} catch (error) {
  console.error('❌ Error testing native bindings:', error);
  process.exit(1);
}