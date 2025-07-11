export interface ModuleId {
  id: string;
}

export interface InstanceId {
  id: string;
}

export enum Language {
  Rust = 'rust',
  JavaScript = 'javascript',
  TypeScript = 'typescript',
  Python = 'python',
  Go = 'go',
  C = 'c',
  Cpp = 'cpp',
  Wasm = 'wasm',
}

export enum RuntimeType {
  Wasm = 'wasm',
  Ebpf = 'ebpf',
  V8Isolate = 'v8isolate',
  Firecracker = 'firecracker',
  Python = 'python',
}

export interface ExecutionConfig {
  timeout: number; // milliseconds
  memoryLimit: number; // bytes
  permissions: Permissions;
}

export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number; // milliseconds
  memoryUsed: number; // bytes
}

export interface Permissions {
  capabilities: Set<Capability>;
  trustLevel: TrustLevel;
}

export enum Capability {
  NetworkAccess = 'network_access',
  FileSystemRead = 'filesystem_read',
  FileSystemWrite = 'filesystem_write',
  ProcessSpawn = 'process_spawn',
  SystemTime = 'system_time',
  EnvironmentVariables = 'environment_variables',
  SharedMemory = 'shared_memory',
  CpuIntensive = 'cpu_intensive',
  GpuAccess = 'gpu_access',
}

export enum TrustLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export interface Runtime {
  compile(code: string, language: Language): Promise<ModuleId>;
  instantiate(moduleId: ModuleId): Promise<InstanceId>;
  execute(instanceId: InstanceId, config: ExecutionConfig): Promise<ExecutionResult>;
  destroy(instanceId: InstanceId): Promise<void>;
}

export interface RuntimeMetrics {
  coldStartLatency: number; // nanoseconds
  memoryOverhead: number; // bytes
  executionOverheadPercent: number;
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}