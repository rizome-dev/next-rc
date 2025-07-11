import { useState, useCallback } from 'react';
import { Language, TrustLevel, Capability } from '@rizome/next-rc-types';

export interface ExecuteOptions {
  code: string;
  language?: Language;
  timeout?: number;
  memory?: number;
  trustLevel?: TrustLevel;
  capabilities?: Capability[];
  hints?: {
    expectedDuration?: number;
    latencyRequirement?: 'ultra-low' | 'low' | 'normal' | 'relaxed';
    complexity?: 'simple' | 'moderate' | 'complex';
  };
}

export interface ExecuteResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime?: number;
  memoryUsed?: number;
  runtime?: string;
}

export function useRuntimeController() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (options: ExecuteOptions): Promise<ExecuteResult> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trust-Level': options.trustLevel || TrustLevel.Low,
          ...(options.hints?.latencyRequirement && {
            'X-Latency-SLA': options.hints.latencyRequirement,
          }),
        },
        body: JSON.stringify({
          code: options.code,
          language: options.language || Language.JavaScript,
          timeout: options.timeout || 30000,
          memory: options.memory || 128 * 1024 * 1024,
          permissions: {
            capabilities: options.capabilities || [],
          },
          hints: options.hints || {},
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Execution failed');
      }

      // Extract metadata from headers
      const runtime = response.headers.get('X-Runtime-Used') || undefined;
      
      return {
        ...data,
        runtime,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const compile = useCallback(async (
    code: string,
    language: Language = Language.JavaScript
  ): Promise<{ success: boolean; moduleId?: string; error?: string }> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agent/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, language }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Compilation failed');
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const getMetrics = useCallback(async () => {
    try {
      const response = await fetch('/api/agent/metrics');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch metrics');
      }

      return data.metrics;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return null;
    }
  }, []);

  return {
    execute,
    compile,
    getMetrics,
    loading,
    error,
  };
}