import { RuntimeType } from '@rizome/next-rc-types';
import { WorkloadProfile } from './workload-profiler';
import { Task, SchedulingDecision } from './intelligent-scheduler';

interface ExecutionHistory {
  runtime: RuntimeType;
  success: boolean;
  executionTime: number;
  totalTime: number;
}

export class RuntimeSelector {
  private readonly runtimeCapabilities = {
    [RuntimeType.Ebpf]: {
      profiles: [WorkloadProfile.SimpleFilter],
      maxLatency: 0.001, // 1μs
      languages: ['c', 'ebpf'],
      memoryLimit: 1024 * 1024, // 1MB
      features: ['filters', 'ultra-low-latency'],
    },
    [RuntimeType.Wasm]: {
      profiles: [WorkloadProfile.ShortCompute, WorkloadProfile.HeavyCompute],
      maxLatency: 0.05, // 50μs
      languages: ['rust', 'c', 'cpp', 'go', 'wasm'],
      memoryLimit: 128 * 1024 * 1024, // 128MB
      features: ['general-compute', 'low-latency', 'multi-language'],
    },
    [RuntimeType.V8Isolate]: {
      profiles: [WorkloadProfile.JavaScript],
      maxLatency: 5, // 5ms
      languages: ['javascript', 'typescript'],
      memoryLimit: 512 * 1024 * 1024, // 512MB
      features: ['javascript', 'pre-warming', 'async'],
    },
    [RuntimeType.Firecracker]: {
      profiles: [WorkloadProfile.HeavyCompute, WorkloadProfile.Untrusted, WorkloadProfile.IoIntensive],
      maxLatency: 125, // 125ms
      languages: ['all'],
      memoryLimit: 4 * 1024 * 1024 * 1024, // 4GB
      features: ['strong-isolation', 'full-os', 'any-language'],
    },
    [RuntimeType.Python]: {
      profiles: [WorkloadProfile.ShortCompute, WorkloadProfile.HeavyCompute],
      maxLatency: 50, // 50ms
      languages: ['python'],
      memoryLimit: 512 * 1024 * 1024, // 512MB
      features: ['python-native', 'ml-libraries', 'data-processing'],
    },
  };

  selectRuntime(
    profile: WorkloadProfile,
    task: Task,
    history: ExecutionHistory[]
  ): SchedulingDecision {
    // First, check if we have successful historical data
    const historicalDecision = this.selectFromHistory(profile, history);
    if (historicalDecision) {
      return historicalDecision;
    }

    // Profile-based selection
    const profileDecision = this.selectByProfile(profile, task);
    if (profileDecision) {
      return profileDecision;
    }

    // Latency-based selection
    const latencyDecision = this.selectByLatency(task);
    if (latencyDecision) {
      return latencyDecision;
    }

    // Language-based selection
    const languageDecision = this.selectByLanguage(task);
    if (languageDecision) {
      return languageDecision;
    }

    // Default fallback
    return {
      runtime: RuntimeType.Wasm,
      reason: 'Default fallback - general purpose runtime',
      confidence: 0.5,
    };
  }

  private selectFromHistory(
    _profile: WorkloadProfile,
    history: ExecutionHistory[]
  ): SchedulingDecision | null {
    if (history.length === 0) return null;

    // Calculate success rate and average latency per runtime
    const runtimeStats = new Map<RuntimeType, {
      successes: number;
      total: number;
      avgLatency: number;
    }>();

    for (const execution of history) {
      if (!runtimeStats.has(execution.runtime)) {
        runtimeStats.set(execution.runtime, {
          successes: 0,
          total: 0,
          avgLatency: 0,
        });
      }

      const stats = runtimeStats.get(execution.runtime)!;
      stats.total++;
      if (execution.success) {
        stats.successes++;
      }
      stats.avgLatency = 
        (stats.avgLatency * (stats.total - 1) + execution.totalTime) / stats.total;
    }

    // Find best runtime based on success rate and latency
    let bestRuntime: RuntimeType | null = null;
    let bestScore = -1;

    for (const [runtime, stats] of runtimeStats) {
      const successRate = stats.successes / stats.total;
      const latencyScore = 1 / (1 + stats.avgLatency / 1000); // Normalize to 0-1
      const score = successRate * 0.7 + latencyScore * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestRuntime = runtime;
      }
    }

    if (bestRuntime && bestScore > 0.8) {
      return {
        runtime: bestRuntime,
        reason: `Historical performance: ${Math.round(bestScore * 100)}% score`,
        confidence: bestScore,
      };
    }

    return null;
  }

  private selectByProfile(
    profile: WorkloadProfile,
    task: Task
  ): SchedulingDecision | null {
    // Direct profile mapping
    switch (profile) {
      case WorkloadProfile.SimpleFilter:
        return {
          runtime: RuntimeType.Ebpf,
          reason: 'Ultra-low latency filter workload',
          confidence: 0.95,
        };

      case WorkloadProfile.ShortCompute:
        return {
          runtime: RuntimeType.Wasm,
          reason: 'Low latency general compute',
          confidence: 0.9,
        };

      case WorkloadProfile.JavaScript:
        return {
          runtime: RuntimeType.V8Isolate,
          reason: 'JavaScript/TypeScript workload',
          confidence: 0.95,
        };

      case WorkloadProfile.HeavyCompute:
      case WorkloadProfile.Untrusted:
        if (task.resourceRequirements?.memory && 
            task.resourceRequirements.memory > 128 * 1024 * 1024) {
          return {
            runtime: RuntimeType.Firecracker,
            reason: 'Heavy compute with high memory requirements',
            confidence: 0.85,
          };
        }
        return {
          runtime: RuntimeType.Wasm,
          reason: 'Heavy compute within WASM limits',
          confidence: 0.8,
        };

      case WorkloadProfile.IoIntensive:
        return {
          runtime: RuntimeType.Firecracker,
          reason: 'I/O intensive workload requires full OS',
          confidence: 0.9,
        };

      case WorkloadProfile.MemoryIntensive:
        if (task.resourceRequirements?.memory && 
            task.resourceRequirements.memory > 512 * 1024 * 1024) {
          return {
            runtime: RuntimeType.Firecracker,
            reason: 'Memory requirements exceed isolate limits',
            confidence: 0.95,
          };
        }
        return null;
    }

    return null;
  }

  private selectByLatency(task: Task): SchedulingDecision | null {
    if (!task.latencyRequirement) return null;

    switch (task.latencyRequirement) {
      case 'ultra-low':
        return {
          runtime: RuntimeType.Ebpf,
          reason: 'Ultra-low latency requirement (<1μs)',
          confidence: 0.9,
        };

      case 'low':
        return {
          runtime: RuntimeType.Wasm,
          reason: 'Low latency requirement (<50μs)',
          confidence: 0.85,
        };

      case 'normal':
        // V8 with pre-warming can achieve good latency
        if (task.language === 'javascript' || task.language === 'typescript') {
          return {
            runtime: RuntimeType.V8Isolate,
            reason: 'Normal latency with JavaScript',
            confidence: 0.8,
          };
        }
        return null;

      case 'relaxed':
        // Any runtime is fine
        return null;
    }
  }

  private selectByLanguage(task: Task): SchedulingDecision | null {
    const language = task.language.toLowerCase();

    // Find runtimes that support this language
    const compatibleRuntimes: RuntimeType[] = [];
    
    for (const [runtime, capabilities] of Object.entries(this.runtimeCapabilities)) {
      if (capabilities.languages.includes(language) || 
          capabilities.languages.includes('all')) {
        compatibleRuntimes.push(runtime as RuntimeType);
      }
    }

    if (compatibleRuntimes.length === 0) {
      return null;
    }

    // Prefer runtime with lowest latency
    compatibleRuntimes.sort((a, b) => {
      const aLatency = this.runtimeCapabilities[a].maxLatency;
      const bLatency = this.runtimeCapabilities[b].maxLatency;
      return aLatency - bLatency;
    });

    return {
      runtime: compatibleRuntimes[0],
      reason: `Best runtime for ${language} language`,
      confidence: 0.75,
    };
  }
}