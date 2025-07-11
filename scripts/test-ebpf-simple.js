#!/usr/bin/env node
// Simple test for eBPF runtime to debug execution issues
const native = require('../runtimes/napi-bridge');

// Enum values
const Language = { C: 5 };
const TrustLevel = { High: 2 };

async function testSimpleEbpf() {
  console.log('🚀 Testing Simple eBPF Execution\n');
  
  try {
    const ebpfBridge = new native.EbpfRuntimeBridge();
    console.log('✅ eBPF runtime bridge created');
    
    await ebpfBridge.initialize();
    console.log('✅ eBPF runtime initialized');
    
    // Try the simplest possible eBPF program - just return a constant
    const simpleCode = `
    int simple_prog(void *ctx) {
        return 0;
    }
    `;
    
    console.log('📋 Compiling simple eBPF program...');
    const moduleId = await ebpfBridge.compile(simpleCode, Language.C);
    console.log('✅ Compiled:', moduleId);
    
    console.log('📋 Loading program...');
    const instanceId = await ebpfBridge.loadProgram(moduleId);
    console.log('✅ Loaded:', instanceId);
    
    console.log('📋 Executing program...');
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout after 5 seconds')), 5000);
    });
    
    const executePromise = ebpfBridge.execute(instanceId, {
      timeoutMs: 1000,
      memoryLimitBytes: 1024 * 1024,
      trustLevel: TrustLevel.High,
      networkAccess: false,
      filesystemAccess: false
    });
    
    const result = await Promise.race([executePromise, timeoutPromise]);
    console.log('✅ Execution result:', result);
    
    // Check metrics
    const metrics = await ebpfBridge.getPerformanceMetrics();
    console.log('📊 Metrics:', metrics);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testSimpleEbpf().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});