import {
  Runtime,
  RuntimeType,
  Language,
  ExecutionConfig,
  ExecutionResult,
} from '@rizome/next-rc-types';
import { WorkloadProfiler } from './workload-profiler';
import { RuntimeSelector } from './runtime-selector';

export interface SchedulingDecision {
  runtime: RuntimeType;
  reason: string;
  confidence: number;
}

export interface Task {
  code: string;
  language: Language;
  expectedDuration?: number;
  latencyRequirement?: 'ultra-low' | 'low' | 'normal' | 'relaxed';
  complexity?: 'simple' | 'moderate' | 'complex';
  resourceRequirements?: {
    memory?: number;
    cpu?: 'low' | 'medium' | 'high';
    io?: boolean;
  };
}

export interface RuntimeRegistry {
  [RuntimeType.Wasm]?: Runtime;
  [RuntimeType.Ebpf]?: Runtime;
  [RuntimeType.V8Isolate]?: Runtime;
  [RuntimeType.Firecracker]?: Runtime;
  [RuntimeType.Python]?: Runtime;
}

interface ExecutionMetrics {
  success: boolean;
  executionTime: number;
  memoryUsed: number;
  totalTime: number;
  runtime: RuntimeType;
  timestamp: number;
}

export class IntelligentScheduler {
  private profiler: WorkloadProfiler;
  private selector: RuntimeSelector;
  private runtimes: RuntimeRegistry;
  private executionHistory: Map<string, ExecutionMetrics[]> = new Map();

  constructor(runtimes: RuntimeRegistry) {
    this.runtimes = runtimes;
    this.profiler = new WorkloadProfiler();
    this.selector = new RuntimeSelector();
  }

  async schedule(task: Task): Promise<SchedulingDecision> {
    // Profile the workload
    const profile = await this.profiler.analyze(task);
    
    // Get historical performance data
    const history = this.getHistoricalData(task);
    
    // Make scheduling decision
    const decision = this.selector.selectRuntime(profile, task, history);
    
    console.log(
      `Scheduled ${task.language} task to ${decision.runtime} ` +
      `(reason: ${decision.reason}, confidence: ${decision.confidence})`
    );
    
    return decision;
  }

  async execute(
    task: Task,
    config: ExecutionConfig
  ): Promise<ExecutionResult & { runtime: RuntimeType }> {
    const startTime = Date.now();
    
    // Get scheduling decision
    const decision = await this.schedule(task);
    
    // Get the selected runtime
    const runtime = this.runtimes[decision.runtime];
    if (!runtime) {
      throw new Error(`Runtime ${decision.runtime} not available`);
    }
    
    // Compile and execute
    const moduleId = await runtime.compile(task.code, task.language);
    const instanceId = await runtime.instantiate(moduleId);
    
    try {
      const result = await runtime.execute(instanceId, config);
      
      // Record execution metrics
      this.recordExecution(task, decision.runtime, {
        success: result.success,
        executionTime: result.executionTime,
        memoryUsed: result.memoryUsed,
        totalTime: Date.now() - startTime,
        runtime: decision.runtime,
        timestamp: Date.now(),
      });
      
      return {
        ...result,
        runtime: decision.runtime,
      };
    } finally {
      await runtime.destroy(instanceId);
    }
  }

  private getHistoricalData(task: Task): ExecutionMetrics[] {
    const key = this.getTaskKey(task);
    return this.executionHistory.get(key) || [];
  }

  private recordExecution(
    task: Task,
    runtime: RuntimeType,
    metrics: ExecutionMetrics
  ): void {
    const key = this.getTaskKey(task);
    const history = this.executionHistory.get(key) || [];
    
    history.push({
      ...metrics,
      runtime,
      timestamp: Date.now(),
    });
    
    // Keep only last 100 executions
    if (history.length > 100) {
      history.shift();
    }
    
    this.executionHistory.set(key, history);
  }

  private getTaskKey(task: Task): string {
    // Create a unique key for similar tasks
    const codeHash = this.simpleHash(task.code);
    return `${task.language}-${codeHash}-${task.complexity || 'unknown'}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  getMetrics(): SchedulerMetrics {
    const metrics: SchedulerMetrics = {
      totalExecutions: 0,
      runtimeDistribution: {
        [RuntimeType.Wasm]: 0,
        [RuntimeType.Ebpf]: 0,
        [RuntimeType.V8Isolate]: 0,
        [RuntimeType.Firecracker]: 0,
        [RuntimeType.Python]: 0,
      },
      averageLatencyByRuntime: {
        [RuntimeType.Wasm]: { total: 0, count: 0, average: 0 },
        [RuntimeType.Ebpf]: { total: 0, count: 0, average: 0 },
        [RuntimeType.V8Isolate]: { total: 0, count: 0, average: 0 },
        [RuntimeType.Firecracker]: { total: 0, count: 0, average: 0 },
        [RuntimeType.Python]: { total: 0, count: 0, average: 0 },
      },
      successRateByRuntime: {
        [RuntimeType.Wasm]: { success: 0, total: 0, rate: 0 },
        [RuntimeType.Ebpf]: { success: 0, total: 0, rate: 0 },
        [RuntimeType.V8Isolate]: { success: 0, total: 0, rate: 0 },
        [RuntimeType.Firecracker]: { success: 0, total: 0, rate: 0 },
        [RuntimeType.Python]: { success: 0, total: 0, rate: 0 },
      },
    };

    for (const history of this.executionHistory.values()) {
      for (const execution of history) {
        metrics.totalExecutions++;
        metrics.runtimeDistribution[execution.runtime]++;
        
        // Calculate average latency
        if (!metrics.averageLatencyByRuntime[execution.runtime]) {
          metrics.averageLatencyByRuntime[execution.runtime] = {
            total: 0,
            count: 0,
            average: 0,
          };
        }
        
        const latencyMetrics = metrics.averageLatencyByRuntime[execution.runtime];
        latencyMetrics.total += execution.totalTime;
        latencyMetrics.count++;
        latencyMetrics.average = latencyMetrics.total / latencyMetrics.count;
        
        // Calculate success rate
        if (!metrics.successRateByRuntime[execution.runtime]) {
          metrics.successRateByRuntime[execution.runtime] = {
            success: 0,
            total: 0,
            rate: 0,
          };
        }
        
        const successMetrics = metrics.successRateByRuntime[execution.runtime];
        successMetrics.total++;
        if (execution.success) {
          successMetrics.success++;
        }
        successMetrics.rate = successMetrics.success / successMetrics.total;
      }
    }

    return metrics;
  }
}


export interface SchedulerMetrics {
  totalExecutions: number;
  runtimeDistribution: Record<RuntimeType, number>;
  averageLatencyByRuntime: Record<RuntimeType, {
    total: number;
    count: number;
    average: number;
  }>;
  successRateByRuntime: Record<RuntimeType, {
    success: number;
    total: number;
    rate: number;
  }>;
}