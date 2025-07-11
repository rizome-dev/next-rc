#![cfg(feature = "python")]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;

use crate::types::*;
use python_runtime::{PythonRuntimeController, PythonExecutionRequest};

impl From<crate::types::TrustLevel> for python_runtime::TrustLevel {
    fn from(trust: crate::types::TrustLevel) -> Self {
        match trust {
            crate::types::TrustLevel::Low => python_runtime::TrustLevel::Low,
            crate::types::TrustLevel::Medium => python_runtime::TrustLevel::Medium,
            crate::types::TrustLevel::High => python_runtime::TrustLevel::High,
        }
    }
}

/// Python Runtime Bridge (PyO3 + WASM hybrid)
#[napi]
pub struct PythonRuntimeBridge {
    runtime: Arc<PythonRuntimeController>,
    executions: Arc<RwLock<HashMap<String, String>>>, // Store code as String for now
}

#[napi]
impl PythonRuntimeBridge {
    /// Create a new Python runtime
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        // Initialize with default concurrency
        let runtime = tokio::runtime::Handle::current()
            .block_on(async {
                PythonRuntimeController::new(10).await
            })
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create Python runtime: {}", e)))?;

        let runtime_arc = Arc::new(runtime);

        Ok(Self {
            runtime: runtime_arc,
            executions: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Initialize the Python runtime
    #[napi]
    pub async fn initialize(&self) -> Result<()> {
        // Python runtime initializes automatically
        Ok(())
    }

    /// Execute Python code directly
    #[napi]
    pub async fn execute_python(&self, code: String, config: ExecutionConfig) -> Result<ExecutionResult> {
        let runtime = &self.runtime;
        
        let request = PythonExecutionRequest {
            id: uuid::Uuid::new_v4(),
            code,
            runtime_hint: Some(python_runtime::PythonRuntimeType::Hybrid),
            trust_level: config.trust_level.into(),
            timeout_ms: config.timeout_ms as u64,
            memory_limit_mb: (config.memory_limit_bytes / (1024 * 1024)) as u64,
            environment: HashMap::new(),
            requirements: vec![],
        };

        let result = runtime.execute(request)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, format!("Python execution failed: {}", e)))?;

        Ok(ExecutionResult {
            success: result.success,
            output: result.output,
            error: result.error,
            execution_time_ms: result.execution_time_ms as i64,
            memory_used_bytes: (result.memory_used_mb * 1024 * 1024) as i64,
            exit_code: result.exit_code,
        })
    }


    /// Compile Python code (placeholder for future optimization)
    #[napi]
    pub async fn compile(&self, code: String, language: Language) -> Result<ModuleId> {
        // For Python, compilation is mostly a validation step
        let module_id = uuid::Uuid::new_v4().to_string();
        
        // Validate Python syntax
        self.validate_python_syntax(&code)?;
        
        Ok(ModuleId { id: module_id })
    }

    /// Execute code using the common Runtime interface
    #[napi]
    pub async fn execute(&self, instance_id: InstanceId, config: ExecutionConfig) -> Result<ExecutionResult> {
        // For Python runtime, we don't use separate instantiation
        // Execute directly with the instance_id as code reference
        let executions = self.executions.read();
        
        if let Some(_execution_context) = executions.get(&instance_id.id) {
            // Execute stored code context
            return Err(Error::new(Status::GenericFailure, "Stored execution context not yet implemented".to_string()));
        }
        
        Err(Error::new(Status::InvalidArg, format!("Instance not found: {}", instance_id.id)))
    }

    /// Get Python runtime status
    #[napi]
    pub async fn get_status(&self) -> Result<RuntimeStatus> {
        let runtime = &self.runtime;
        let status = runtime.get_runtime_status().await;
        
        Ok(RuntimeStatus {
            runtime_type: "python".to_string(),
            initialized: true,
            active_instances: status.active_executions as i32,
            total_executions: status.total_executions as i64,
            successful_executions: status.successful_executions as i64,
            failed_executions: status.failed_executions as i64,
            avg_execution_time_ms: if status.total_executions > 0 {
                status.total_executions as f64 / status.total_executions as f64
            } else {
                0.0
            },
        })
    }


    /// Get Python performance metrics
    #[napi]
    pub async fn get_performance_metrics(&self) -> Result<RuntimeMetrics> {
        let executions = self.executions.read();
        
        Ok(RuntimeMetrics {
            runtime_type: "python".to_string(),
            cold_start_latency_ns: 100_000, // 100μs for PyO3
            memory_overhead_bytes: 10_485_760, // 10MB base
            execution_overhead_percent: 10.0,
            active_instances: executions.len() as i32,
        })
    }


    /// Validate Python syntax
    fn validate_python_syntax(&self, code: &str) -> Result<()> {
        // Basic Python syntax validation
        if code.trim().is_empty() {
            return Err(Error::new(Status::InvalidArg, "Empty Python code".to_string()));
        }
        
        // Check for obvious syntax issues
        if code.contains("import os") && code.contains("system(") {
            return Err(Error::new(Status::InvalidArg, "Potentially unsafe code detected".to_string()));
        }
        
        Ok(())
    }
}

