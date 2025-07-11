# Next.js Runtime Controller (next-rc)

[paper](https://github.com/rizome-dev/next-rc/blob/main/paper.pdf)

built by: [rizome labs](https://rizome.dev)

contact us: [hi (at) rizome.dev](mailto:hi@rizome.dev)

## Installation

```bash
# Install the Next.js integration package
npm install @rizome/next-rc-integration
# or
yarn add @rizome/next-rc-integration
# or
pnpm add @rizome/next-rc-integration

# For direct runtime controller usage, also install:
npm install @rizome/next-rc-core @rizome/next-rc-types
```

## Package Structure

- `@rizome/next-rc-integration` - Next.js integration with hooks and API routes
- `@rizome/next-rc-core` - Core runtime controller
- `@rizome/next-rc-types` - TypeScript type definitions
- `@rizome/next-rc-v8` - V8 Isolate runtime
- `@rizome/next-rc-wasm` - WebAssembly runtime
- `@rizome/next-rc-ebpf` - eBPF runtime
- `@rizome/next-rc-python` - Python runtime
- `@rizome/next-rc-lattice` - Distributed orchestration
- `@rizome/next-rc-native` - Native Rust bridge

## Configuration

### next.config.js

```javascript
const { withRuntimeController } = require('@rizome/next-rc-integration');

module.exports = withRuntimeController({
  experimental: {
    runtimeController: {
      type: 'hybrid',
      fluidCompute: {
        enabled: true,
        concurrency: 'auto',
      },
      edgeRuntime: {
        engine: 'wasm',
        preWarm: true,
      },
      lattice: {
        enabled: true,
        natsUrl: process.env.NATS_URL,
      },
    },
  },
});
```

## Basic Usage

### 1. Initialize the Runtime Controller

```typescript
import { RuntimeController } from '@rizome/next-rc-core';
import { Language, TrustLevel } from '@rizome/next-rc-types';

const controller = RuntimeController.getInstance({
  enableScheduler: true,
  runtimes: {
    v8: { enabled: true },
    wasm: { enabled: true },
    ebpf: { enabled: true },
  },
  concurrency: 100,
});

await controller.initialize();
```

### 2. Execute Code in Different Languages

#### JavaScript/TypeScript (V8 Runtime)
```typescript
const jsResult = await controller.executeWithScheduler(
  `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    
    fibonacci(20);
  `,
  Language.JavaScript,
  {
    timeout: 5000,
    memoryLimit: 64 * 1024 * 1024,
    permissions: {
      capabilities: new Set(['cpu_intensive']),
      trustLevel: TrustLevel.High,
    },
  }
);

console.log(`JavaScript result: ${jsResult.output}`);
console.log(`Runtime used: ${jsResult.runtime}`); // "v8isolate"
console.log(`Execution time: ${jsResult.executionTime}ms`);
```

#### Rust (WASM Runtime)
```typescript
const rustResult = await controller.executeWithScheduler(
  `
    fn fibonacci(n: u32) -> u32 {
        match n {
            0 => 0,
            1 => 1,
            _ => fibonacci(n - 1) + fibonacci(n - 2),
        }
    }
    
    #[no_mangle]
    pub extern "C" fn main() -> u32 {
        fibonacci(20)
    }
  `,
  Language.Rust,
  {
    timeout: 3000,
    memoryLimit: 32 * 1024 * 1024,
    permissions: {
      capabilities: new Set(['cpu_intensive']),
      trustLevel: TrustLevel.Medium,
    },
  },
  {
    latencyRequirement: 'low',
    complexity: 'moderate',
  }
);

console.log(`Rust result: ${rustResult.output}`);
console.log(`Runtime used: ${rustResult.runtime}`); // "wasm"
console.log(`Execution time: ${rustResult.executionTime}ms`);
```

#### C (eBPF Runtime)
```typescript
const ebpfResult = await controller.executeWithScheduler(
  `
    int packet_filter(void *data, int data_len) {
        // Simple packet filter - allow all HTTP traffic
        if (data_len > 20) {
            return 1; // Allow
        }
        return 0; // Drop
    }
  `,
  Language.C,
  {
    timeout: 100,
    memoryLimit: 1024 * 1024,
    permissions: {
      capabilities: new Set(['network_access']),
      trustLevel: TrustLevel.Low,
    },
  },
  {
    latencyRequirement: 'ultra-low',
    complexity: 'simple',
  }
);

console.log(`eBPF result: ${ebpfResult.output}`);
console.log(`Runtime used: ${ebpfResult.runtime}`); // "ebpf"
console.log(`Execution time: ${ebpfResult.executionTime}ms`); // Should be <1ms
```

#### Python (Hybrid PyO3/WASM)
```typescript
const pythonResult = await controller.executeWithScheduler(
  `
    import numpy as np
    
    def analyze_data(data):
        arr = np.array(data)
        return {
            'mean': float(np.mean(arr)),
            'std': float(np.std(arr)),
            'max': float(np.max(arr)),
            'min': float(np.min(arr))
        }
    
    data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    result = analyze_data(data)
    result
  `,
  Language.Python,
  {
    timeout: 10000,
    memoryLimit: 128 * 1024 * 1024,
    permissions: {
      capabilities: new Set(['cpu_intensive']),
      trustLevel: TrustLevel.High,
    },
  }
);

console.log(`Python result:`, pythonResult.output);
console.log(`Runtime used: ${pythonResult.runtime}`); // Could be "wasm" or "v8isolate"
```

## Advanced Usage

### 1. Intelligent Runtime Selection

The scheduler automatically selects the best runtime based on workload characteristics:

```typescript
// Ultra-low latency requirement -> eBPF
const filterResult = await controller.executeWithScheduler(
  simpleFilterCode,
  Language.C,
  config,
  {
    latencyRequirement: 'ultra-low',
    expectedDuration: 1,
    complexity: 'simple',
  }
);

// High performance requirement -> WASM
const computeResult = await controller.executeWithScheduler(
  computeIntensiveCode,
  Language.Rust,
  config,
  {
    latencyRequirement: 'low',
    expectedDuration: 100,
    complexity: 'complex',
  }
);

// JavaScript/TypeScript -> V8
const jsResult = await controller.executeWithScheduler(
  webLogicCode,
  Language.TypeScript,
  config,
  {
    latencyRequirement: 'normal',
    complexity: 'moderate',
  }
);
```

### 2. Direct Runtime Control

For explicit runtime control:

```typescript
// Compile and execute with specific runtime
const moduleId = await controller.compile(code, Language.Rust);
const instanceId = await controller.instantiate(moduleId);

try {
  const result = await controller.execute(instanceId, {
    timeout: 5000,
    memoryLimit: 64 * 1024 * 1024,
    permissions: {
      capabilities: new Set(['cpu_intensive']),
      trustLevel: TrustLevel.High,
    },
  });
  
  console.log('Execution result:', result);
} finally {
  await controller.destroy(instanceId);
}
```

### 3. Performance Monitoring

```typescript
// Get overall metrics
const metrics = controller.getMetrics();
console.log('Available runtimes:', metrics.availableRuntimes);
console.log('Queue size:', metrics.queueSize);
console.log('Active executions:', metrics.queuePending);

// Runtime-specific metrics
const runtimeMetrics = await controller.getRuntimeMetrics();
console.log('Runtime performance:', runtimeMetrics);
```

## Next.js Integration

### Using the React Hook

```typescript
// app/components/CodeRunner.tsx
import { useRuntimeController } from '@rizome/next-rc-integration';
import { Language, TrustLevel } from '@rizome/next-rc-types';

export function CodeRunner() {
  const { execute, loading, error } = useRuntimeController();
  
  const runCode = async () => {
    const result = await execute({
      code: 'console.log("Hello from runtime!");',
      language: Language.JavaScript,
      config: {
        timeout: 5000,
        memoryLimit: 64 * 1024 * 1024,
        permissions: {
          capabilities: new Set(['cpu_intensive']),
          trustLevel: TrustLevel.Medium,
        },
      },
    });
    
    console.log('Result:', result);
  };
  
  return (
    <button onClick={runCode} disabled={loading}>
      {loading ? 'Running...' : 'Run Code'}
    </button>
  );
}
```

### API Route Example

```typescript
// app/api/execute/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { RuntimeController } from '@rizome/next-rc-core';
import { Language, TrustLevel } from '@rizome/next-rc-types';

export async function POST(request: NextRequest) {
  const { code, language, config } = await request.json();
  
  const controller = RuntimeController.getInstance();
  
  try {
    const result = await controller.executeWithScheduler(
      code,
      language as Language,
      {
        timeout: config.timeout || 5000,
        memoryLimit: config.memoryLimit || 64 * 1024 * 1024,
        permissions: {
          capabilities: new Set(config.capabilities || []),
          trustLevel: config.trustLevel || TrustLevel.Medium,
        },
      },
      {
        latencyRequirement: config.latencyRequirement || 'normal',
        complexity: config.complexity || 'moderate',
      }
    );
    
    return NextResponse.json({
      success: result.success,
      output: result.output,
      runtime: result.runtime,
      executionTime: result.executionTime,
      memoryUsed: result.memoryUsed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### Usage in Components

```typescript
// components/CodeExecutor.tsx
import { useState } from 'react';
import { Language } from '@rizome/next-rc-types';

export function CodeExecutor() {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<Language>(Language.JavaScript);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const executeCode = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          config: {
            timeout: 10000,
            memoryLimit: 128 * 1024 * 1024,
            capabilities: ['cpu_intensive'],
            trustLevel: 'high',
            latencyRequirement: 'normal',
            complexity: 'moderate',
          },
        }),
      });
      
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <select 
        value={language} 
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        <option value={Language.JavaScript}>JavaScript</option>
        <option value={Language.TypeScript}>TypeScript</option>
        <option value={Language.Rust}>Rust</option>
        <option value={Language.Python}>Python</option>
        <option value={Language.C}>C (eBPF)</option>
        <option value={Language.Wasm}>WASM</option>
      </select>
      
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter your code here..."
        rows={10}
        cols={80}
      />
      
      <button onClick={executeCode} disabled={loading}>
        {loading ? 'Executing...' : 'Execute Code'}
      </button>
      
      {result && (
        <div>
          <h3>Result:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## Security Considerations

### Trust Levels

```typescript
// Low trust - Maximum sandboxing
const lowTrustConfig = {
  permissions: {
    capabilities: new Set(), // No special capabilities
    trustLevel: TrustLevel.Low,
  },
};

// Medium trust - Balanced security/performance
const mediumTrustConfig = {
  permissions: {
    capabilities: new Set(['cpu_intensive']),
    trustLevel: TrustLevel.Medium,
  },
};

// High trust - Maximum performance
const highTrustConfig = {
  permissions: {
    capabilities: new Set(['cpu_intensive', 'network_access', 'filesystem_read']),
    trustLevel: TrustLevel.High,
  },
};
```

### Capability Management

```typescript
const capabilities = new Set([
  'network_access',      // Network operations
  'filesystem_read',     // File system read access
  'filesystem_write',    // File system write access
  'process_spawn',       // Spawn child processes
  'system_time',         // Access system time
  'environment_variables', // Access env vars
  'shared_memory',       // Shared memory access
  'cpu_intensive',       // CPU-intensive operations
  'gpu_access',          // GPU access
]);
```

## Production Deployment

### Configuration

```typescript
const productionConfig = {
  enableScheduler: true,
  runtimes: {
    v8: { enabled: true },
    wasm: { enabled: true },
    ebpf: { enabled: true },
  },
  concurrency: 1000, // High concurrency for production
  metrics: {
    enabled: true,
    endpoint: '/metrics',
  },
  logging: {
    level: 'info',
    structured: true,
  },
};
```

### Monitoring

```typescript
// Set up metrics collection
const metrics = controller.getMetrics();
const runtimeMetrics = await controller.getRuntimeMetrics();

// Log performance data
console.log('System metrics:', {
  totalExecutions: metrics.totalExecutions,
  successRate: metrics.successfulExecutions / metrics.totalExecutions,
  avgExecutionTime: metrics.avgExecutionTime,
  activeRuntimes: metrics.availableRuntimes,
});
```

### Runtime Selection

The system automatically selects the optimal runtime based on:
- **Language**: JavaScript→V8, Rust→WASM, C→eBPF
- **Latency requirements**: ultra-low→eBPF, low→WASM, normal→V8
- **Complexity**: simple→eBPF, moderate→WASM, complex→V8

Override automatic selection:
```typescript
const result = await controller.executeWithScheduler(
  code,
  language,
  config,
  {
    latencyRequirement: 'ultra-low', // Forces eBPF for C code
    complexity: 'simple',
    expectedDuration: 1 // milliseconds
  }
);
```

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/rizome-dev/next-rc.git
cd next-rc

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Environment Variables

```env
RUNTIME_CONTROLLER_TYPE=hybrid
RUNTIME_CONTROLLER_MAX_WORKERS=4
RUNTIME_CONTROLLER_TIMEOUT_MS=30000
NATS_URL=nats://localhost:4222  # Optional, for distributed mode
HF_TOKEN=your_hugging_face_token # Optional, for AI integrations
```

### Running Benchmarks

To validate the performance claims (39x improvement for smolagents):
```bash
# From root directory
pnpm benchmark

# Specific benchmark suites
cd packages/benchmarks
pnpm benchmark:smolagents
```

## Architecture

The Next.js Runtime Controller uses a modular architecture:

1. **Core Controller** - Manages runtime lifecycle and scheduling
2. **Runtime Adapters** - Interfaces for V8, WASM, eBPF, Python
3. **Intelligent Scheduler** - Selects optimal runtime based on workload
4. **Security Manager** - Enforces sandboxing and permissions
5. **Lattice Network** - Optional distributed execution via NATS

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built with ❤️  by Rizome Labs, Inc.

## License

Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.