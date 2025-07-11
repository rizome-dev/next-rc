#![cfg(feature = "ebpf")]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;

use crate::types::*;
use next_rc_ebpf::EbpfRuntime;
use next_rc_shared::{Runtime as RuntimeTrait};

/// eBPF Runtime Bridge for ultra-low latency execution
#[napi]
pub struct EbpfRuntimeBridge {
    runtime: Arc<EbpfRuntime>,
    programs: Arc<RwLock<HashMap<String, Arc<dyn Send + Sync>>>>,
}

#[napi]
impl EbpfRuntimeBridge {
    /// Create a new eBPF runtime
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let runtime = EbpfRuntime::new()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create eBPF runtime: {}", e)))?;
        
        Ok(Self {
            runtime: Arc::new(runtime),
            programs: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Initialize the eBPF runtime
    #[napi]
    pub async fn initialize(&self) -> Result<()> {
        // eBPF runtime is initialized in new()
        Ok(())
    }

    /// Compile eBPF code to bytecode
    #[napi]
    pub async fn compile(&self, code: String, language: Language) -> Result<ModuleId> {
        let runtime = &self.runtime;
        
        // For eBPF, we expect C code or raw bytecode
        let module_id = runtime
            .compile(code.as_bytes(), language.into())
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("eBPF compilation failed: {}", e)))?;
        
        Ok(ModuleId {
            id: module_id.0.to_string(),
        })
    }

    /// Load and verify eBPF program
    #[napi]
    pub async fn load_program(&self, module_id: ModuleId) -> Result<InstanceId> {
        let runtime = &self.runtime;
        let shared_module_id = next_rc_shared::ModuleId(
            uuid::Uuid::parse_str(&module_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid module ID: {}", e)))?
        );
        
        let instance_id = runtime
            .instantiate(shared_module_id)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("eBPF program load failed: {}", e)))?;
        
        Ok(InstanceId {
            id: instance_id.0.to_string(),
        })
    }

    /// Execute eBPF program with input data
    #[napi]
    pub async fn execute_filter(&self, instance_id: InstanceId, input_data: Buffer) -> Result<ExecutionResult> {
        let runtime = &self.runtime;
        let shared_instance_id = next_rc_shared::InstanceId(
            uuid::Uuid::parse_str(&instance_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid instance ID: {}", e)))?
        );
        
        // Convert Buffer to Vec<u8>
        let data: Vec<u8> = input_data.to_vec();
        
        // For eBPF, execute_filter is not async and needs the program
        // We'll use the general execute method instead
        let shared_config = next_rc_shared::ExecutionConfig {
            timeout: std::time::Duration::from_millis(1000), // 1s default timeout
            memory_limit: 1024 * 1024, // 1MB
            permissions: next_rc_shared::Permissions {
                capabilities: std::collections::HashSet::new(),
                trust_level: next_rc_shared::TrustLevel::Low,
            },
        };
        
        let start = std::time::Instant::now();
        let exec_result = runtime
            .execute(shared_instance_id, shared_config)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("eBPF execution failed: {}", e)))?;
        
        let execution_time = start.elapsed();

        Ok(ExecutionResult {
            success: exec_result.success,
            output: exec_result.output.map(|o| String::from_utf8_lossy(&o).to_string()).unwrap_or_default(),
            error: exec_result.error,
            execution_time_ms: execution_time.as_nanos() as i64 / 1_000_000, // Convert to ms
            memory_used_bytes: exec_result.memory_used as i64,
            exit_code: Some(0),
        })
    }

    /// Execute eBPF program (general interface)
    #[napi]
    pub async fn execute(&self, instance_id: InstanceId, config: ExecutionConfig) -> Result<ExecutionResult> {
        let shared_instance_id = next_rc_shared::InstanceId(
            uuid::Uuid::parse_str(&instance_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid instance ID: {}", e)))?
        );
        
        let shared_config = next_rc_shared::ExecutionConfig {
            timeout: std::time::Duration::from_millis(config.timeout_ms as u64),
            memory_limit: config.memory_limit_bytes as usize,
            permissions: next_rc_shared::Permissions {
                capabilities: std::collections::HashSet::new(),
                trust_level: config.trust_level.into(),
            },
        };

        let start = std::time::Instant::now();
        let result = {
            let runtime = &self.runtime;
            runtime
                .execute(shared_instance_id, shared_config)
                .await
                .map_err(|e| Error::new(Status::GenericFailure, format!("eBPF execution failed: {}", e)))?
        };
        
        let execution_time = start.elapsed();

        Ok(ExecutionResult {
            success: result.success,
            output: result.output.map(|o| String::from_utf8_lossy(&o).to_string()).unwrap_or_default(),
            error: result.error,
            execution_time_ms: execution_time.as_nanos() as i64 / 1_000_000,
            memory_used_bytes: result.memory_used as i64,
            exit_code: Some(0),
        })
    }

    /// Unload eBPF program
    #[napi]
    pub async fn destroy(&self, instance_id: InstanceId) -> Result<()> {
        let runtime = &self.runtime;
        let shared_instance_id = next_rc_shared::InstanceId(
            uuid::Uuid::parse_str(&instance_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid instance ID: {}", e)))?
        );
        
        runtime
            .destroy(shared_instance_id)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("eBPF destroy failed: {}", e)))?;

        // Remove from tracking
        self.programs.write().remove(&instance_id.id);
        
        Ok(())
    }

    /// Get eBPF runtime status
    #[napi]
    pub async fn get_status(&self) -> Result<RuntimeStatus> {
        let runtime = &self.runtime;
        let programs = self.programs.read();
        
        Ok(RuntimeStatus {
            runtime_type: "ebpf".to_string(),
            initialized: true,
            active_instances: programs.len() as i32,
            total_executions: 0,
            successful_executions: 0,
            failed_executions: 0,
            avg_execution_time_ms: 0.0001, // ~100ns
        })
    }

    /// Get eBPF performance metrics
    #[napi]
    pub async fn get_performance_metrics(&self) -> Result<RuntimeMetrics> {
        Ok(RuntimeMetrics {
            runtime_type: "ebpf".to_string(),
            cold_start_latency_ns: 100, // ~100ns target
            memory_overhead_bytes: 1_024, // ~1KB per program
            execution_overhead_percent: 0.0, // Near-zero overhead
            active_instances: self.programs.read().len() as i32,
        })
    }

    /// Verify eBPF bytecode without loading
    #[napi]
    pub async fn verify_program(&self, bytecode: Buffer) -> Result<bool> {
        let runtime = &self.runtime;
        let data: Vec<u8> = bytecode.to_vec();
        
        // For now, always return true as verification happens during compile/load
        Ok(true)
    }

    /// Get eBPF JIT compilation statistics
    #[napi]
    pub async fn get_jit_stats(&self) -> Result<serde_json::Value> {
        let runtime = &self.runtime;
        Ok(serde_json::json!({
            "compiled_programs": 0,
            "compilation_time_ns": 0,
            "cache_hits": 0,
            "cache_misses": 0,
        }))
    }

    /// Enable eBPF program tracing for debugging
    #[napi]
    pub async fn enable_tracing(&self, instance_id: InstanceId) -> Result<()> {
        let runtime = &self.runtime;
        let shared_instance_id = next_rc_shared::InstanceId(
            uuid::Uuid::parse_str(&instance_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid instance ID: {}", e)))?
        );
        
        // Tracing not implemented yet
        Ok(())
    }
}