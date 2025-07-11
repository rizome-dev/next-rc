// Configuration
export { withRuntimeController, getRuntimeConfig } from './config';
export type { NextRCConfig } from './config';

// Hooks
export { useRuntimeController } from './hooks/useRuntimeController';
export type { ExecuteOptions, ExecuteResult } from './hooks/useRuntimeController';

// Components
export { CodeExecutor } from './components/CodeExecutor';
export type { CodeExecutorProps } from './components/CodeExecutor';

// API Routes (for manual setup if needed)
export * as executeRoute from './api/agent/execute/route';
export * as compileRoute from './api/agent/compile/route';
export * as metricsRoute from './api/agent/metrics/route';

// Re-export core types for convenience
export {
  Language,
  RuntimeType,
  TrustLevel,
  Capability,
  type ModuleId,
  type InstanceId,
  type ExecutionConfig,
  type ExecutionResult,
  type Permissions,
  type Runtime,
  type RuntimeMetrics,
  RuntimeError,
} from '@rizome/next-rc-types';