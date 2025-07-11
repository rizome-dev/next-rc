#!/usr/bin/env node
// Test eBPF runtime execution with actual BPF bytecode
const native = require('../runtimes/napi-bridge');

// Enum values from NAPI
const Language = {
  Rust: 0,
  JavaScript: 1,
  TypeScript: 2,
  Python: 3,
  Go: 4,
  C: 5,
  Cpp: 6,
  Wasm: 7
};

const TrustLevel = {
  Low: 0,
  Medium: 1,
  High: 2
};

async function testEbpfExecution() {
  console.log('🚀 Testing eBPF Runtime Execution\n');
  
  try {
    // Create eBPF runtime bridge
    const ebpfBridge = new native.EbpfRuntimeBridge();
    console.log('✅ eBPF runtime bridge created');
    
    // Initialize the runtime
    await ebpfBridge.initialize();
    console.log('✅ eBPF runtime initialized');
    
    // Test 1: Simple packet filter (return XDP_PASS)
    console.log('\n📋 Test 1: Simple XDP packet filter');
    const xdpFilter = `
    // Simple XDP program that passes all packets
    int xdp_prog(void *ctx) {
        return 2; // XDP_PASS
    }
    `;
    
    const xdpModuleId = await ebpfBridge.compile(xdpFilter, Language.C);
    console.log('✅ XDP filter compiled:', xdpModuleId);
    
    // Load the program to get an instance ID
    const xdpInstanceId = await ebpfBridge.loadProgram(xdpModuleId);
    console.log('✅ XDP program loaded:', xdpInstanceId);
    
    const xdpResult = await ebpfBridge.execute(
      xdpInstanceId,
      {
        timeoutMs: 1000,
        memoryLimitBytes: 1024 * 1024,
        trustLevel: TrustLevel.High,
        networkAccess: false,
        filesystemAccess: false
      }
    );
    console.log('📊 XDP filter result:', xdpResult);
    
    // Test 2: Socket filter (accept all)
    console.log('\n📋 Test 2: Socket filter');
    const socketFilter = `
    // Socket filter that accepts all packets
    int socket_filter(void *ctx) {
        return 0xFFFF; // Accept packet
    }
    `;
    
    const socketModuleId = await ebpfBridge.compile(socketFilter, Language.C);
    console.log('✅ Socket filter compiled:', socketModuleId);
    
    // Load the program
    const socketInstanceId = await ebpfBridge.loadProgram(socketModuleId);
    console.log('✅ Socket program loaded:', socketInstanceId);
    
    const socketResult = await ebpfBridge.execute(
      socketInstanceId,
      {
        timeoutMs: 1000,
        memoryLimitBytes: 1024 * 1024,
        trustLevel: TrustLevel.High,
        networkAccess: false,
        filesystemAccess: false
      }
    );
    console.log('📊 Socket filter result:', socketResult);
    
    // Test 3: eBPF bytecode (raw BPF instructions)
    console.log('\n📋 Test 3: Raw eBPF bytecode');
    // BPF bytecode for: return 42
    // MOV64_IMM(R0, 42)
    // EXIT
    const bytecode = new Uint8Array([
      0xb7, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, // mov r0, 42
      0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00  // exit
    ]);
    
    const bytecodeModuleId = await ebpfBridge.compile(Buffer.from(bytecode).toString('base64'), Language.C);
    console.log('✅ eBPF bytecode compiled:', bytecodeModuleId);
    
    // Load the bytecode program
    const bytecodeInstanceId = await ebpfBridge.loadProgram(bytecodeModuleId);
    console.log('✅ Bytecode program loaded:', bytecodeInstanceId);
    
    const bytecodeResult = await ebpfBridge.execute(
      bytecodeInstanceId,
      {
        timeoutMs: 1000,
        memoryLimitBytes: 1024 * 1024,
        trustLevel: TrustLevel.High,
        networkAccess: false,
        filesystemAccess: false
      }
    );
    console.log('📊 Bytecode result:', bytecodeResult);
    
    // Get runtime status
    console.log('\n📊 Getting runtime status...');
    const status = await ebpfBridge.getStatus();
    console.log('Runtime status:', status);
    
    // Get metrics
    const metrics = await ebpfBridge.getPerformanceMetrics();
    console.log('\n📈 Runtime metrics:', metrics);
    
    console.log('\n✅ All eBPF tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testEbpfExecution().then(() => {
  console.log('\n🎉 eBPF runtime tests passed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});