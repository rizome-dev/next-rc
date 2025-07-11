import { IntelligentScheduler, Task } from '../scheduler/intelligent-scheduler';
import { WorkloadProfiler, WorkloadProfile } from '../scheduler/workload-profiler';
import { RuntimeSelector } from '../scheduler/runtime-selector';
import { RuntimeType, Language, TrustLevel } from '@rizome/next-rc-types';

describe('WorkloadProfiler', () => {
  let profiler: WorkloadProfiler;

  beforeEach(() => {
    profiler = new WorkloadProfiler();
  });

  it('should identify simple filters', async () => {
    const task: Task = {
      code: `
        function filter(data) {
          return data.port === 80;
        }
      `,
      language: Language.JavaScript,
      latencyRequirement: 'ultra-low',
    };

    const profile = await profiler.analyze(task);
    expect(profile).toBe(WorkloadProfile.SimpleFilter);
  });

  it('should identify JavaScript workloads', async () => {
    const task: Task = {
      code: `
        async function main() {
          const result = await processData();
          return result;
        }
      `,
      language: Language.JavaScript,
    };

    const profile = await profiler.analyze(task);
    expect(profile).toBe(WorkloadProfile.JavaScript);
  });

  it('should identify I/O intensive workloads', async () => {
    const task: Task = {
      code: `
        async function main() {
          const data = await fetch('https://api.example.com/data');
          const result = await database.query('SELECT * FROM users');
          return { data, result };
        }
      `,
      language: Language.JavaScript,
    };

    const profile = await profiler.analyze(task);
    expect(profile).toBe(WorkloadProfile.IoIntensive);
  });

  it('should identify memory intensive workloads', async () => {
    const task: Task = {
      code: `
        function processImage() {
          const buffer = new ArrayBuffer(1024 * 1024 * 100);
          const matrix = new Array(1000000);
          for (let i = 0; i < matrix.length; i++) {
            matrix[i] = new Array(100);
          }
          return matrix;
        }
      `,
      language: Language.JavaScript,
    };

    const profile = await profiler.analyze(task);
    expect(profile).toBe(WorkloadProfile.MemoryIntensive);
  });

  it('should identify complex compute workloads', async () => {
    const task: Task = {
      code: `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        
        function main() {
          for (let i = 0; i < 100; i++) {
            for (let j = 0; j < 100; j++) {
              fibonacci(30);
            }
          }
        }
      `,
      language: Language.JavaScript,
      complexity: 'complex',
    };

    const profile = await profiler.analyze(task);
    expect(profile).toBe(WorkloadProfile.HeavyCompute);
  });
});

describe('RuntimeSelector', () => {
  let selector: RuntimeSelector;

  beforeEach(() => {
    selector = new RuntimeSelector();
  });

  it('should select eBPF for simple filters', () => {
    const decision = selector.selectRuntime(
      WorkloadProfile.SimpleFilter,
      {
        code: 'filter code',
        language: Language.C,
      },
      []
    );

    expect(decision.runtime).toBe(RuntimeType.Ebpf);
    expect(decision.confidence).toBeGreaterThan(0.9);
  });

  it('should select WASM for short compute', () => {
    const decision = selector.selectRuntime(
      WorkloadProfile.ShortCompute,
      {
        code: 'compute code',
        language: Language.Rust,
      },
      []
    );

    expect(decision.runtime).toBe(RuntimeType.Wasm);
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it('should select V8 for JavaScript', () => {
    const decision = selector.selectRuntime(
      WorkloadProfile.JavaScript,
      {
        code: 'js code',
        language: Language.JavaScript,
      },
      []
    );

    expect(decision.runtime).toBe(RuntimeType.V8Isolate);
    expect(decision.confidence).toBeGreaterThan(0.9);
  });

  it('should use historical data when available', () => {
    const history = [
      {
        runtime: RuntimeType.Wasm,
        success: true,
        executionTime: 10,
        totalTime: 15,
      },
      {
        runtime: RuntimeType.Wasm,
        success: true,
        executionTime: 12,
        totalTime: 17,
      },
    ];

    const decision = selector.selectRuntime(
      WorkloadProfile.ShortCompute,
      {
        code: 'compute code',
        language: Language.Rust,
      },
      history
    );

    expect(decision.runtime).toBe(RuntimeType.Wasm);
    expect(decision.reason).toContain('Historical performance');
  });

  it('should respect latency requirements', () => {
    const decision = selector.selectRuntime(
      WorkloadProfile.ShortCompute,
      {
        code: 'code',
        language: Language.C,
        latencyRequirement: 'ultra-low',
      },
      []
    );

    expect(decision.runtime).toBe(RuntimeType.Ebpf);
    expect(decision.reason).toContain('Ultra-low latency');
  });
});

describe('IntelligentScheduler', () => {
  let scheduler: IntelligentScheduler;
  let mockV8Runtime: any;

  beforeEach(() => {
    mockV8Runtime = {
      compile: jest.fn().mockResolvedValue({ id: 'module-1' }),
      instantiate: jest.fn().mockResolvedValue({ id: 'instance-1' }),
      execute: jest.fn().mockResolvedValue({
        success: true,
        output: { result: 42 },
        executionTime: 10,
        memoryUsed: 1024,
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    scheduler = new IntelligentScheduler({
      [RuntimeType.V8Isolate]: mockV8Runtime,
    });
  });

  it('should schedule and execute tasks', async () => {
    const task: Task = {
      code: 'function main() { return 42; }',
      language: Language.JavaScript,
    };

    const config = {
      timeout: 1000,
      memoryLimit: 128 * 1024 * 1024,
      permissions: {
        capabilities: new Set(),
        trustLevel: TrustLevel.Low,
      },
    };

    const result = await scheduler.execute(task, config);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: 42 });
    expect(result.runtime).toBe(RuntimeType.V8Isolate);
    expect(mockV8Runtime.compile).toHaveBeenCalled();
    expect(mockV8Runtime.instantiate).toHaveBeenCalled();
    expect(mockV8Runtime.execute).toHaveBeenCalled();
    expect(mockV8Runtime.destroy).toHaveBeenCalled();
  });

  it('should track execution metrics', async () => {
    const task: Task = {
      code: 'function main() { return 42; }',
      language: Language.JavaScript,
    };

    const config = {
      timeout: 1000,
      memoryLimit: 128 * 1024 * 1024,
      permissions: {
        capabilities: new Set(),
        trustLevel: TrustLevel.Low,
      },
    };

    await scheduler.execute(task, config);
    await scheduler.execute(task, config);

    const metrics = scheduler.getMetrics();
    expect(metrics.totalExecutions).toBe(2);
    expect(metrics.runtimeDistribution[RuntimeType.V8Isolate]).toBe(2);
    expect(metrics.successRateByRuntime[RuntimeType.V8Isolate].rate).toBe(1);
  });

  it('should make scheduling decisions', async () => {
    const task: Task = {
      code: 'function filter(data) { return data.port === 80; }',
      language: Language.JavaScript,
      latencyRequirement: 'low',
    };

    const decision = await scheduler.schedule(task);
    
    expect(decision).toBeDefined();
    expect(decision.runtime).toBeDefined();
    expect(decision.reason).toBeDefined();
    expect(decision.confidence).toBeGreaterThan(0);
  });
});