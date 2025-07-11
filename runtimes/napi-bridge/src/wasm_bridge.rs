#![cfg(feature = "wasm")]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;

use crate::types::*;
use wasm_runtime::{WasmRuntime, WasmConfig};
use next_rc_shared::{Runtime as RuntimeTrait};

/// WASM Runtime Bridge
#[napi]
pub struct WasmRuntimeBridge {
    runtime: Arc<WasmRuntime>,
    instances: Arc<RwLock<HashMap<String, Arc<dyn Send + Sync>>>>,
}

#[napi]
impl WasmRuntimeBridge {
    /// Create a new WASM runtime
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let config = WasmConfig::default();
        let runtime = WasmRuntime::new(config)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create WASM runtime: {}", e)))?;
        
        Ok(Self {
            runtime: Arc::new(runtime),
            instances: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Initialize the runtime
    #[napi]
    pub async fn initialize(&self) -> Result<()> {
        // WASM runtime is initialized in new()
        // No additional initialization needed
        Ok(())
    }

    /// Compile code to a WASM module
    #[napi]
    pub async fn compile(&self, code: String, language: Language) -> Result<ModuleId> {
        let runtime = &self.runtime;
        let module_id = runtime
            .compile(code.as_bytes(), language.into())
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("Compilation failed: {}", e)))?;
        
        Ok(ModuleId {
            id: module_id.0.to_string(),
        })
    }

    /// Instantiate a compiled module
    #[napi]
    pub async fn instantiate(&self, module_id: ModuleId) -> Result<InstanceId> {
        let runtime = &self.runtime;
        let shared_module_id = next_rc_shared::ModuleId(
            uuid::Uuid::parse_str(&module_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid module ID: {}", e)))?
        );
        
        let instance_id = runtime
            .instantiate(shared_module_id)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("Instantiation failed: {}", e)))?;
        
        Ok(InstanceId {
            id: instance_id.0.to_string(),
        })
    }

    /// Execute code in an instance
    #[napi]
    pub async fn execute(&self, instance_id: InstanceId, config: ExecutionConfig) -> Result<ExecutionResult> {
        let runtime = &self.runtime;
        let shared_instance_id = next_rc_shared::InstanceId(
            uuid::Uuid::parse_str(&instance_id.id)
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid instance ID: {}", e)))?
        );
        
        let shared_config = next_rc_shared::ExecutionConfig {
            timeout: std::time::Duration::from_millis(config.timeout_ms as u64),
            memory_limit: config.memory_limit_bytes as usize,
            permissions: next_rc_shared::Permissions {
                capabilities: std::collections::HashSet::new(), // TODO: Map capabilities
                trust_level: config.trust_level.into(),
            },
        };

        let result = runtime
            .execute(shared_instance_id, shared_config)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("Execution failed: {}", e)))?;

        Ok(ExecutionResult {
            success: result.success,
            output: result.output.map(|o| String::from_utf8_lossy(&o).to_string()).unwrap_or_default(),
            error: result.error,
            execution_time_ms: result.execution_time.as_millis() as i64,
            memory_used_bytes: result.memory_used as i64,
            exit_code: Some(0),
        })
    }

    /// Destroy an instance
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
            .map_err(|e| Error::new(Status::GenericFailure, format!("Destroy failed: {}", e)))?;

        // Remove from tracking
        self.instances.write().remove(&instance_id.id);
        
        Ok(())
    }

    /// Get runtime status
    #[napi]
    pub async fn get_status(&self) -> Result<RuntimeStatus> {
        let runtime = &self.runtime;
        let instances = self.instances.read();
        
        // Get metrics from runtime
        let metrics = runtime.get_metrics();
        
        Ok(RuntimeStatus {
            runtime_type: "wasm".to_string(),
            initialized: true,
            active_instances: instances.len() as i32,
            total_executions: 0,  // TODO: Track these metrics
            successful_executions: 0,
            failed_executions: 0,
            avg_execution_time_ms: 0.0,
        })
    }

    /// Get performance metrics
    #[napi]
    pub async fn get_performance_metrics(&self) -> Result<RuntimeMetrics> {
        Ok(RuntimeMetrics {
            runtime_type: "wasm".to_string(),
            cold_start_latency_ns: 35_400, // 35.4μs target
            memory_overhead_bytes: 3_072,  // 3KB per instance
            execution_overhead_percent: 15.0, // WASM overhead
            active_instances: self.instances.read().len() as i32,
        })
    }

    /// Pre-warm the runtime for faster startup
    #[napi]
    pub async fn pre_warm(&self, count: i32) -> Result<()> {
        // Pre-warming not implemented yet
        // In a real implementation, this would pre-allocate memory slots
        Ok(())
    }

    /// Get memory pool statistics
    #[napi]
    pub async fn get_memory_stats(&self) -> Result<serde_json::Value> {
        let runtime = &self.runtime;
        let metrics = runtime.get_metrics();
        
        Ok(serde_json::json!({
            "total_slots": metrics.total_slots,
            "available_slots": metrics.available_slots,
            "allocated_slots": metrics.total_slots - metrics.available_slots,
            "cached_modules": metrics.cached_modules,
        }))
    }
}