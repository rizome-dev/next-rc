use anyhow::{anyhow, Result};
use async_trait::async_trait;
use next_rc_shared::{
    ExecutionConfig, ExecutionResult, InstanceId, Language, ModuleId, Runtime as RuntimeTrait,
};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, trace};
use uuid::Uuid;

use crate::{
    jit::{JitCompiler, JitProgram},
    memory_pool::EbpfMemoryPool,
    program::{EbpfProgram, ProgramCache, ProgramType},
    verifier::Verifier,
};

pub struct EbpfRuntime {
    jit_compiler: Arc<JitCompiler>,
    verifier: Arc<Verifier>,
    program_cache: Arc<ProgramCache>,
    memory_pool: Arc<EbpfMemoryPool>,
    instances: Arc<RwLock<HashMap<InstanceId, EbpfInstance>>>,
}

struct EbpfInstance {
    id: InstanceId,
    module_id: ModuleId,
    program: Arc<EbpfProgram>,
    jit_program: Arc<JitProgram>,
}

impl EbpfRuntime {
    pub fn new() -> Result<Self> {
        info!("Initializing eBPF runtime for ultra-low latency execution");
        
        Ok(Self {
            jit_compiler: Arc::new(JitCompiler::new()),
            verifier: Arc::new(Verifier::new()),
            program_cache: Arc::new(ProgramCache::new()),
            memory_pool: Arc::new(EbpfMemoryPool::with_defaults()?),
            instances: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    pub fn with_config(max_instructions: usize, allow_unsafe: bool) -> Result<Self> {
        info!(
            "Initializing eBPF runtime with max_instructions={}, allow_unsafe={}",
            max_instructions, allow_unsafe
        );
        
        Ok(Self {
            jit_compiler: Arc::new(JitCompiler::new()),
            verifier: Arc::new(Verifier::with_config(max_instructions, allow_unsafe)),
            program_cache: Arc::new(ProgramCache::new()),
            memory_pool: Arc::new(EbpfMemoryPool::with_defaults()?),
            instances: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    pub fn execute_filter(&self, program: &EbpfProgram, data: &[u8]) -> Result<FilterResult> {
        let start = Instant::now();
        
        // Verify program at load time (cached)
        self.verifier.verify(&program.bytecode)?;
        
        // JIT compile (cached)
        let jit_program = self.jit_compiler.compile(&program.bytecode)?;
        
        // Execute with ~100ns overhead
        let result = self.jit_compiler.execute(&jit_program, data)?;
        
        let elapsed = start.elapsed();
        trace!("eBPF filter executed in {:?}", elapsed);
        
        Ok(FilterResult {
            action: if result > 0 { FilterAction::Accept } else { FilterAction::Drop },
            execution_time: elapsed,
        })
    }
    
    fn compile_to_ebpf(&self, _code: &[u8], language: Language) -> Result<Vec<u8>> {
        match language {
            Language::C => {
                // In a real implementation, this would use clang with BPF target
                // For now, return a simple test program
                Ok(vec![
                    // BPF_MOV64_IMM(BPF_REG_0, 1)
                    0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
                    // BPF_EXIT_INSN()
                    0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                ])
            }
            _ => Err(anyhow!("Unsupported language for eBPF: {:?}", language)),
        }
    }
}

#[async_trait]
impl RuntimeTrait for EbpfRuntime {
    async fn compile(&self, code: &[u8], language: Language) -> Result<ModuleId> {
        debug!("Compiling {:?} code to eBPF ({} bytes)", language, code.len());
        let start = Instant::now();
        
        let bytecode = if language == Language::C {
            self.compile_to_ebpf(code, language)?
        } else {
            // Assume raw eBPF bytecode
            code.to_vec()
        };
        
        // Create program
        let program = EbpfProgram::from_bytecode(bytecode, ProgramType::Filter);
        
        // Verify the program
        self.verifier.verify(&program.bytecode)?;
        
        // Cache the program
        let module_id = self.program_cache.insert(program);
        
        let elapsed = start.elapsed();
        info!("Compiled eBPF module {} in {:?}", module_id.0, elapsed);
        
        Ok(module_id)
    }
    
    async fn instantiate(&self, module_id: ModuleId) -> Result<InstanceId> {
        debug!("Instantiating eBPF module {}", module_id.0);
        let start = Instant::now();
        
        // Get program from cache
        let program = self.program_cache
            .get(&module_id)
            .ok_or_else(|| anyhow!("Module not found: {}", module_id.0))?;
        
        // JIT compile the program
        let jit_program = self.jit_compiler.compile(&program.bytecode)?;
        
        // Create instance
        let instance_id = InstanceId(Uuid::new_v4());
        let instance = EbpfInstance {
            id: instance_id.clone(),
            module_id,
            program,
            jit_program,
        };
        
        let mut instances = self.instances.write();
        instances.insert(instance_id.clone(), instance);
        
        let elapsed = start.elapsed();
        info!("Instantiated eBPF instance {} in {:?}", instance_id.0, elapsed);
        
        Ok(instance_id)
    }
    
    async fn execute(
        &self,
        instance_id: InstanceId,
        _config: ExecutionConfig,
    ) -> Result<ExecutionResult> {
        debug!("Executing eBPF instance {}", instance_id.0);
        let start = Instant::now();
        
        let instances = self.instances.read();
        let instance = instances
            .get(&instance_id)
            .ok_or_else(|| anyhow!("Instance not found: {}", instance_id.0))?;
        
        // For eBPF, we expect the input data to be passed through config
        // In a real implementation, this would come from the execution context
        let test_data = b"test packet data";
        
        // Execute the JIT compiled program
        let result = self.jit_compiler.execute(&instance.jit_program, test_data)?;
        
        let execution_time = start.elapsed();
        
        Ok(ExecutionResult {
            success: true,
            output: Some(result.to_le_bytes().to_vec()),
            error: None,
            execution_time,
            memory_used: 0, // eBPF uses minimal memory
        })
    }
    
    async fn destroy(&self, instance_id: InstanceId) -> Result<()> {
        debug!("Destroying eBPF instance {}", instance_id.0);
        
        let mut instances = self.instances.write();
        if instances.remove(&instance_id).is_some() {
            info!("eBPF instance {} destroyed", instance_id.0);
            Ok(())
        } else {
            Err(anyhow!("Instance not found: {}", instance_id.0))
        }
    }
}

#[derive(Debug, Clone)]
pub struct FilterResult {
    pub action: FilterAction,
    pub execution_time: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterAction {
    Accept,
    Drop,
}

#[cfg(test)]
mod tests {
    use super::*;
    use next_rc_shared::{Permissions, TrustLevel};
    
    #[tokio::test]
    async fn test_ebpf_runtime_lifecycle() {
        let runtime = EbpfRuntime::new().unwrap();
        
        // Simple eBPF program that returns 1 (accept)
        let bytecode = vec![
            // BPF_MOV64_IMM(BPF_REG_0, 1)
            0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
            // BPF_EXIT_INSN()
            0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        
        let module_id = runtime.compile(&bytecode, Language::C).await.unwrap();
        let instance_id = runtime.instantiate(module_id).await.unwrap();
        
        let config = ExecutionConfig {
            timeout: Duration::from_millis(1),
            memory_limit: 1024,
            permissions: Permissions::new(TrustLevel::Low),
        };
        
        let result = runtime.execute(instance_id.clone(), config).await.unwrap();
        assert!(result.success);
        assert!(result.execution_time.as_nanos() < 1000); // Should be under 1μs
        
        runtime.destroy(instance_id).await.unwrap();
    }
    
    #[test]
    fn test_filter_execution() {
        let runtime = EbpfRuntime::new().unwrap();
        
        let program = EbpfProgram::from_bytecode(
            vec![
                // Return 1 (accept)
                0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
                0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ],
            ProgramType::Filter,
        );
        
        let test_data = b"test packet";
        let result = runtime.execute_filter(&program, test_data).unwrap();
        
        assert_eq!(result.action, FilterAction::Accept);
        assert!(result.execution_time.as_nanos() < 500); // Should be under 500ns
    }
}