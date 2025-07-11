import { Language, RuntimeType, ExecutionConfig, ExecutionResult, Runtime } from '@rizome/next-rc-types';

export type RuntimeRegistry = {
  [key in RuntimeType]?: Runtime;
};

export interface Task {
  code: string;
  language: Language;
  expectedDuration?: number;
  latencyRequirement?: 'ultra-low' | 'low' | 'normal' | 'relaxed';
  complexity?: 'simple' | 'moderate' | 'complex';
  resourceRequirements?: {
    memory: number;
  };
}

// Stub exports for compatibility
export interface WorkloadProfile {
  language: Language;
  complexity: string;
}

export class WorkloadProfiler {
  static analyze(_code: string): WorkloadProfile {
    return {
      language: Language.JavaScript,
      complexity: 'moderate'
    };
  }
}

export class RuntimeSelector {
  static select(_profile: WorkloadProfile): RuntimeType {
    return RuntimeType.V8Isolate;
  }
}

export interface SchedulingDecision {
  runtime: RuntimeType;
  reason: string;
}

interface SchedulingFactors {
  language: Language;
  latencyRequirement: 'ultra-low' | 'low' | 'normal' | 'relaxed';
  complexity: 'simple' | 'moderate' | 'complex';
  trustLevel: string;
  memoryLimit: number;
  cpuIntensive: boolean;
  networkAccess: boolean;
  estimatedDuration?: number;
}

interface RuntimeScore {
  runtime: RuntimeType;
  score: number;
  reasons: string[];
}

interface ExecutionHistory {
  runtime: RuntimeType;
  language: Language;
  executionTime: number;
  memoryUsed: number;
  success: boolean;
  complexity: string;
  timestamp: number;
}

export class IntelligentScheduler {
  private executionHistory: ExecutionHistory[] = [];
  private readonly maxHistorySize = 1000;
  private runtimes: RuntimeRegistry = {};
  
  constructor(runtimes: RuntimeRegistry) {
    this.runtimes = runtimes;
  }
  
  // Performance characteristics from paper.md
  private readonly runtimeCharacteristics: Record<RuntimeType, {
    coldStart: number;
    languages: Language[];
    maxMemory: number;
    strengths: string[];
    weaknesses: string[];
  }> = {
    [RuntimeType.Ebpf]: {
      coldStart: 100, // nanoseconds
      languages: [Language.C],
      maxMemory: 512 * 1024, // 512KB
      strengths: ['ultra-low-latency', 'packet-filtering', 'security'],
      weaknesses: ['complex-computation', 'high-memory']
    },
    [RuntimeType.Wasm]: {
      coldStart: 35000, // 35 microseconds
      languages: [Language.Rust, Language.C, Language.Cpp, Language.Go, Language.Wasm],
      maxMemory: 256 * 1024 * 1024, // 256MB
      strengths: ['compute-intensive', 'multi-language', 'security'],
      weaknesses: ['ultra-low-latency']
    },
    [RuntimeType.V8Isolate]: {
      coldStart: 5000000, // 5 milliseconds
      languages: [Language.JavaScript, Language.TypeScript],
      maxMemory: 512 * 1024 * 1024, // 512MB
      strengths: ['javascript', 'rapid-development', 'flexibility'],
      weaknesses: ['ultra-low-latency', 'cpu-intensive']
    },
    [RuntimeType.Firecracker]: {
      coldStart: 125000000, // 125 milliseconds
      languages: [Language.JavaScript, Language.TypeScript, Language.Python, Language.Rust, Language.Go, Language.C, Language.Cpp],
      maxMemory: 8 * 1024 * 1024 * 1024, // 8GB
      strengths: ['full-isolation', 'all-languages', 'production-ready'],
      weaknesses: ['cold-start-latency', 'resource-overhead']
    },
    [RuntimeType.Python]: {
      coldStart: 50000000, // 50 milliseconds
      languages: [Language.Python],
      maxMemory: 512 * 1024 * 1024, // 512MB
      strengths: ['python-native', 'ml-libraries', 'data-processing'],
      weaknesses: ['cold-start-latency', 'single-language']
    }
  };

  selectOptimalRuntime(
    factors: SchedulingFactors,
    availableRuntimes: Set<RuntimeType>
  ): RuntimeType {
    const scores = this.calculateRuntimeScores(factors, availableRuntimes);
    
    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    
    if (scores.length === 0) {
      throw new Error('No suitable runtime available');
    }
    
    // Log the decision
    console.debug('Runtime selection:', {
      selected: scores[0].runtime,
      score: scores[0].score,
      reasons: scores[0].reasons,
      alternatives: scores.slice(1)
    });
    
    return scores[0].runtime;
  }
  
  private calculateRuntimeScores(
    factors: SchedulingFactors,
    availableRuntimes: Set<RuntimeType>
  ): RuntimeScore[] {
    const scores: RuntimeScore[] = [];
    
    for (const runtime of availableRuntimes) {
      const score = this.scoreRuntime(runtime, factors);
      if (score) {
        scores.push(score);
      }
    }
    
    return scores;
  }
  
  private scoreRuntime(runtime: RuntimeType, factors: SchedulingFactors): RuntimeScore | null {
    const characteristics = this.runtimeCharacteristics[runtime];
    if (!characteristics) {
      return null;
    }
    
    let score = 100; // Base score
    const reasons: string[] = [];
    
    // Language compatibility (critical factor)
    if (!characteristics.languages.includes(factors.language)) {
      // Check if we can transpile or use a compatibility layer
      if (runtime === RuntimeType.Wasm && this.canCompileToWasm(factors.language)) {
        score -= 10;
        reasons.push('Requires compilation to WASM');
      } else {
        return null; // Incompatible
      }
    } else {
      score += 20;
      reasons.push('Native language support');
    }
    
    // Latency requirements
    switch (factors.latencyRequirement) {
      case 'ultra-low':
        if (characteristics.coldStart <= 1000) { // 1 microsecond
          score += 50;
          reasons.push('Excellent for ultra-low latency');
        } else if (characteristics.coldStart <= 100000) { // 100 microseconds
          score -= 30;
          reasons.push('Acceptable latency');
        } else {
          score -= 100;
          reasons.push('Too slow for ultra-low latency');
        }
        break;
      case 'low':
        if (characteristics.coldStart <= 1000000) { // 1 millisecond
          score += 30;
          reasons.push('Good latency performance');
        } else if (characteristics.coldStart <= 10000000) { // 10 milliseconds
          score += 10;
          reasons.push('Acceptable latency');
        } else {
          score -= 20;
          reasons.push('Higher latency than required');
        }
        break;
      case 'normal':
      case 'relaxed':
        // Latency is not a major factor
        if (characteristics.coldStart <= 10000000) { // 10 milliseconds
          score += 10;
          reasons.push('Reasonable latency');
        }
        break;
    }
    
    // Complexity handling
    switch (factors.complexity) {
      case 'simple':
        if (runtime === RuntimeType.Ebpf) {
          score += 30;
          reasons.push('Perfect for simple filters');
        }
        break;
      case 'moderate':
        if (runtime === RuntimeType.Wasm) {
          score += 20;
          reasons.push('Good for moderate complexity');
        }
        break;
      case 'complex':
        if (runtime === RuntimeType.V8Isolate) {
          score += 20;
          reasons.push('Handles complex logic well');
        } else if (runtime === RuntimeType.Ebpf) {
          score -= 50;
          reasons.push('Too limited for complex tasks');
        }
        break;
    }
    
    // Memory requirements
    if (factors.memoryLimit > characteristics.maxMemory) {
      score -= 100;
      reasons.push('Exceeds memory limit');
    } else if (factors.memoryLimit < characteristics.maxMemory / 10) {
      score += 10;
      reasons.push('Efficient memory usage');
    }
    
    // CPU intensive workloads
    if (factors.cpuIntensive) {
      if (runtime === RuntimeType.Wasm) {
        score += 30;
        reasons.push('Excellent for CPU-intensive tasks');
      } else if (runtime === RuntimeType.Ebpf) {
        score -= 40;
        reasons.push('Limited compute capability');
      }
    }
    
    // Security considerations
    if (factors.trustLevel === 'low') {
      if (runtime === RuntimeType.Ebpf || runtime === RuntimeType.Wasm) {
        score += 20;
        reasons.push('Strong security isolation');
      }
    }
    
    // Learn from history
    const historicalPerformance = this.getHistoricalPerformance(runtime, factors);
    if (historicalPerformance) {
      if (historicalPerformance.avgSuccessRate > 0.9) {
        score += 15;
        reasons.push('Historically reliable');
      } else if (historicalPerformance.avgSuccessRate < 0.5) {
        score -= 20;
        reasons.push('Historical failures');
      }
      
      if (historicalPerformance.avgExecutionTime < factors.estimatedDuration! * 0.8) {
        score += 10;
        reasons.push('Historically fast');
      }
    }
    
    return { runtime, score, reasons };
  }
  
  private canCompileToWasm(language: Language): boolean {
    return [Language.Rust, Language.C, Language.Cpp, Language.Go].includes(language);
  }
  
  private getHistoricalPerformance(
    runtime: RuntimeType,
    factors: SchedulingFactors
  ): { avgExecutionTime: number; avgSuccessRate: number } | null {
    const relevantHistory = this.executionHistory.filter(
      h => h.runtime === runtime && 
           h.language === factors.language &&
           h.complexity === factors.complexity &&
           h.timestamp > Date.now() - 3600000 // Last hour
    );
    
    if (relevantHistory.length === 0) {
      return null;
    }
    
    const avgExecutionTime = relevantHistory.reduce((sum, h) => sum + h.executionTime, 0) / relevantHistory.length;
    const avgSuccessRate = relevantHistory.filter(h => h.success).length / relevantHistory.length;
    
    return { avgExecutionTime, avgSuccessRate };
  }
  
  recordExecution(
    runtime: RuntimeType,
    language: Language,
    executionTime: number,
    memoryUsed: number,
    success: boolean,
    complexity: string
  ): void {
    this.executionHistory.push({
      runtime,
      language,
      executionTime,
      memoryUsed,
      success,
      complexity,
      timestamp: Date.now()
    });
    
    // Keep history size bounded
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }
  
  // Estimate complexity based on code analysis
  estimateComplexity(code: string): 'simple' | 'moderate' | 'complex' {
    const lines = code.split('\n').filter(l => l.trim().length > 0);
    const hasLoops = /\b(for|while|do)\b/.test(code);
    const hasRecursion = this.detectRecursion(code);
    const hasAsyncOps = /\b(async|await|Promise)\b/.test(code);
    
    let complexityScore = 0;
    
    // Line count factor
    if (lines.length < 20) complexityScore += 1;
    else if (lines.length < 100) complexityScore += 2;
    else complexityScore += 3;
    
    // Control flow factor
    if (hasLoops) complexityScore += 2;
    if (hasRecursion) complexityScore += 3;
    if (hasAsyncOps) complexityScore += 2;
    
    // Nested blocks factor
    const maxNesting = this.calculateMaxNesting(code);
    complexityScore += Math.min(maxNesting, 5);
    
    if (complexityScore <= 3) return 'simple';
    if (complexityScore <= 7) return 'moderate';
    return 'complex';
  }
  
  private detectRecursion(code: string): boolean {
    // Simple heuristic: look for function calls within their own definition
    const functionPattern = /function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    const functions = new Set<string>();
    
    let match;
    while ((match = functionPattern.exec(code)) !== null) {
      const funcName = match[1] || match[2];
      if (funcName) functions.add(funcName);
    }
    
    for (const funcName of functions) {
      const funcBodyPattern = new RegExp(`${funcName}\\s*\\([^)]*\\)\\s*{([^}]+)}`);
      const bodyMatch = code.match(funcBodyPattern);
      if (bodyMatch && bodyMatch[1].includes(funcName)) {
        return true;
      }
    }
    
    return false;
  }
  
  private calculateMaxNesting(code: string): number {
    let maxNesting = 0;
    let currentNesting = 0;
    
    for (const char of code) {
      if (char === '{') {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      } else if (char === '}') {
        currentNesting = Math.max(0, currentNesting - 1);
      }
    }
    
    return maxNesting;
  }
  
  async execute(task: Task, config: ExecutionConfig): Promise<ExecutionResult & { runtime: RuntimeType }> {
    // Estimate complexity if not provided
    const complexity = task.complexity || this.estimateComplexity(task.code);
    
    // Prepare scheduling factors
    const factors: SchedulingFactors = {
      language: task.language,
      latencyRequirement: task.latencyRequirement || 'normal',
      complexity,
      trustLevel: config.permissions.trustLevel,
      memoryLimit: config.memoryLimit,
      cpuIntensive: complexity === 'complex',
      networkAccess: config.permissions.capabilities.has('NetworkAccess' as any),
      estimatedDuration: task.expectedDuration
    };
    
    // Get available runtimes
    const availableRuntimes = new Set<RuntimeType>();
    for (const [type, runtime] of Object.entries(this.runtimes)) {
      if (runtime) {
        availableRuntimes.add(type as RuntimeType);
      }
    }
    
    // Select optimal runtime
    const selectedRuntimeType = this.selectOptimalRuntime(factors, availableRuntimes);
    const runtime = this.runtimes[selectedRuntimeType];
    
    if (!runtime) {
      throw new Error(`Runtime ${selectedRuntimeType} not available`);
    }
    
    const startTime = Date.now();
    
    try {
      // Compile and execute
      const moduleId = await runtime.compile(task.code, task.language);
      const instanceId = await runtime.instantiate(moduleId);
      
      const result = await runtime.execute(instanceId, config);
      
      // Record execution for learning
      const executionTime = Date.now() - startTime;
      this.recordExecution(
        selectedRuntimeType,
        task.language,
        executionTime,
        result.memoryUsed || 0,
        result.success,
        complexity
      );
      
      // Clean up
      await runtime.destroy(instanceId);
      
      return {
        ...result,
        runtime: selectedRuntimeType
      };
    } catch (error) {
      // Record failure
      const executionTime = Date.now() - startTime;
      this.recordExecution(
        selectedRuntimeType,
        task.language,
        executionTime,
        0,
        false,
        complexity
      );
      
      throw error;
    }
  }
  
  getMetrics() {
    const totalExecutions = this.executionHistory.length;
    const successfulExecutions = this.executionHistory.filter(h => h.success).length;
    const averageExecutionTime = totalExecutions > 0
      ? this.executionHistory.reduce((sum, h) => sum + h.executionTime, 0) / totalExecutions
      : 0;
    
    const runtimeUsage = new Map<string, number>();
    for (const history of this.executionHistory) {
      const count = runtimeUsage.get(history.runtime) || 0;
      runtimeUsage.set(history.runtime, count + 1);
    }
    
    return {
      totalExecutions,
      successfulExecutions,
      failureRate: totalExecutions > 0 ? (totalExecutions - successfulExecutions) / totalExecutions : 0,
      averageExecutionTime,
      runtimeUsage: Object.fromEntries(runtimeUsage),
      historySize: this.executionHistory.length
    };
  }
}