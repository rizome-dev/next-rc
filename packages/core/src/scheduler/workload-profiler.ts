import { Language } from '@rizome/next-rc-types';
import { Task } from './intelligent-scheduler';

export enum WorkloadProfile {
  SimpleFilter = 'simple-filter',
  ShortCompute = 'short-compute',
  JavaScript = 'javascript',
  HeavyCompute = 'heavy-compute',
  Untrusted = 'untrusted',
  IoIntensive = 'io-intensive',
  MemoryIntensive = 'memory-intensive',
}

export class WorkloadProfiler {
  async analyze(task: Task): Promise<WorkloadProfile> {
    // Use explicit profile if provided
    if (task.latencyRequirement === 'ultra-low') {
      if (this.isSimpleFilter(task)) {
        return WorkloadProfile.SimpleFilter;
      }
      return WorkloadProfile.ShortCompute;
    }

    // Analyze code characteristics first
    const codeAnalysis = this.analyzeCode(task.code, task.language);
    
    // Check for filters
    if (codeAnalysis.isFilter) {
      return WorkloadProfile.SimpleFilter;
    }

    // Check for I/O operations
    if (codeAnalysis.hasIoOperations || task.resourceRequirements?.io) {
      return WorkloadProfile.IoIntensive;
    }

    // Check for memory-intensive operations
    if (codeAnalysis.isMemoryIntensive || 
        (task.resourceRequirements?.memory && task.resourceRequirements.memory > 256 * 1024 * 1024)) {
      return WorkloadProfile.MemoryIntensive;
    }

    // Check computational complexity
    if (task.complexity === 'complex' || 
        codeAnalysis.hasComplexLoops ||
        task.resourceRequirements?.cpu === 'high') {
      return WorkloadProfile.HeavyCompute;
    }

    // Default based on expected duration
    if (task.expectedDuration && task.expectedDuration < 1) {
      return WorkloadProfile.ShortCompute;
    }

    // Language-based default for JavaScript/TypeScript
    if (task.language === Language.JavaScript || task.language === Language.TypeScript) {
      return WorkloadProfile.JavaScript;
    }

    // Conservative default
    return WorkloadProfile.HeavyCompute;
  }

  private isSimpleFilter(task: Task): boolean {
    const code = task.code.toLowerCase();
    
    // Check for filter patterns
    const filterPatterns = [
      /filter\s*\(/,
      /return\s+(true|false|0|1)\s*;/,
      /if\s*\([^)]+\)\s*return/,
      /packet|data|buffer/,
    ];

    return filterPatterns.some(pattern => pattern.test(code)) &&
           !this.hasComplexOperations(code);
  }

  private analyzeCode(code: string, _language: Language): CodeAnalysis {
    const analysis: CodeAnalysis = {
      isFilter: false,
      hasIoOperations: false,
      hasComplexLoops: false,
      isMemoryIntensive: false,
      estimatedComplexity: 'simple',
    };

    const lowerCode = code.toLowerCase();

    // Detect filter patterns
    analysis.isFilter = this.detectFilterPattern(lowerCode);

    // Detect I/O operations
    analysis.hasIoOperations = this.detectIoOperations(lowerCode);

    // Detect complex loops
    analysis.hasComplexLoops = this.detectComplexLoops(lowerCode);

    // Detect memory-intensive operations
    analysis.isMemoryIntensive = this.detectMemoryIntensive(lowerCode);

    // Estimate overall complexity
    analysis.estimatedComplexity = this.estimateComplexity(analysis);

    return analysis;
  }

  private detectFilterPattern(code: string): boolean {
    const patterns = [
      /^[^{]*filter[^{]*{[^}]*return\s+(true|false|0|1)/,
      /accept|drop|allow|deny|pass/,
      /port\s*(===?|==)\s*\d+/,
      /protocol\s*(===?|==)/,
    ];

    return patterns.some(p => p.test(code));
  }

  private detectIoOperations(code: string): boolean {
    const ioPatterns = [
      /fetch|axios|request|http/,
      /readfile|writefile|fs\./,
      /database|db\.|query|sql/,
      /socket|websocket/,
      /stream|pipe/,
      /await\s+.*\.(get|post|put|delete|find|save|update)/,
    ];

    return ioPatterns.some(p => p.test(code));
  }

  private detectComplexLoops(code: string): boolean {
    // Detect nested loops or loops with complex conditions
    const nestedLoopPattern = /(for|while)[^{]*{[^}]*(for|while)/;
    const recursionPattern = /function\s+(\w+)[^{]*{[^}]*\1\s*\(/;
    const matrixPattern = /matrix|multiply|dot\s*product/i;
    const tripleNestedPattern = /(for|while)[^{]*{[^}]*(for|while)[^{]*{[^}]*(for|while)/;
    
    return nestedLoopPattern.test(code) || 
           recursionPattern.test(code) || 
           matrixPattern.test(code) ||
           tripleNestedPattern.test(code);
  }

  private detectMemoryIntensive(code: string): boolean {
    const memoryPatterns = [
      /new\s+Array\s*\(\s*\d{5,}/,  // Arrays with 10000+ elements
      /\[\s*\d{5,}\s*\]/,  // Array literal with large size
      /\.push\s*\(/g,  // Multiple push operations
      /buffer|blob|arraybuffer/,
      /image|video|audio/,
      /matrix|tensor/,
      /1e6|1000000/,  // Large numbers (million+)
    ];

    const pushCount = (code.match(/\.push\s*\(/g) || []).length;
    
    return memoryPatterns.some(p => p.test(code)) || pushCount > 10;
  }

  private hasComplexOperations(code: string): boolean {
    return this.detectComplexLoops(code) || 
           this.detectMemoryIntensive(code) ||
           code.length > 1000; // Large code size
  }

  private estimateComplexity(analysis: CodeAnalysis): 'simple' | 'moderate' | 'complex' {
    let score = 0;

    if (analysis.hasComplexLoops) score += 3;
    if (analysis.isMemoryIntensive) score += 2;
    if (analysis.hasIoOperations) score += 2;

    if (score >= 4) return 'complex';
    if (score >= 2) return 'moderate';
    return 'simple';
  }
}

interface CodeAnalysis {
  isFilter: boolean;
  hasIoOperations: boolean;
  hasComplexLoops: boolean;
  isMemoryIntensive: boolean;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}