import ivm from 'isolated-vm';

export interface V8Module {
  id: string;
  code: string;
  compiled?: ivm.Module;
  metadata: ModuleMetadata;
}

export interface ModuleMetadata {
  language: 'javascript' | 'typescript';
  exports?: string[];
  imports?: string[];
  sourceMap?: string;
}

export interface V8Instance {
  id: string;
  moduleId: string;
  isolate: ivm.Isolate;
  context: ivm.Context;
  startTime: number;
}

export interface IsolateOptions {
  memoryLimit?: number; // MB
  onCatastrophicError?: (error: Error) => void;
}

export interface PrewarmConfig {
  enabled: boolean;
  poolSize: number;
  maxIdleTime: number; // milliseconds
  warmupScript?: string;
}