use crate::{
    PythonExecutionRequest, PythonExecutionResult, PythonRuntimeType, 
    PythonScheduler,
    security::SecurityManager, Result
};
#[cfg(feature = "wasm")]
use crate::WasmPythonRuntime;
#[cfg(feature = "pyo3")]
use crate::PyO3Runtime;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use parking_lot::RwLock;
use dashmap::DashMap;
use uuid::Uuid;
use metrics::{Counter, Histogram, Gauge};

pub struct PythonRuntimeController {
    #[cfg(feature = "pyo3")]
    pyo3_runtime: Arc<PyO3Runtime>,
    #[cfg(feature = "wasm")]
    wasm_runtime: Arc<WasmPythonRuntime>,
    scheduler: Arc<PythonScheduler>,
    security_manager: Arc<SecurityManager>,
    execution_semaphore: Arc<Semaphore>,
    active_executions: Arc<DashMap<Uuid, ExecutionContext>>,
    metrics: Arc<RuntimeMetrics>,
}

struct ExecutionContext {
    runtime_type: PythonRuntimeType,
    started_at: Instant,
    trust_level: crate::TrustLevel,
}

struct RuntimeMetrics {
    total_executions: Counter,
    successful_executions: Counter,
    failed_executions: Counter,
    execution_duration: Histogram,
    active_executions: Gauge,
    pyo3_executions: Counter,
    wasm_executions: Counter,
    memory_usage: Gauge,
}

impl PythonRuntimeController {
    pub async fn new(max_concurrent_executions: usize) -> Result<Self> {
        let security_manager = Arc::new(SecurityManager::new()?);
        
        #[cfg(feature = "pyo3")]
        let pyo3_runtime = Arc::new(PyO3Runtime::new(security_manager.clone())?);
        #[cfg(feature = "wasm")]
        let wasm_runtime = Arc::new(WasmPythonRuntime::new().await?);
        let scheduler = Arc::new(PythonScheduler::new()?);
        
        let execution_semaphore = Arc::new(Semaphore::new(max_concurrent_executions));
        let active_executions = Arc::new(DashMap::new());
        
        let metrics = Arc::new(RuntimeMetrics {
            total_executions: metrics::counter!("python_runtime_executions_total"),
            successful_executions: metrics::counter!("python_runtime_executions_successful"),
            failed_executions: metrics::counter!("python_runtime_executions_failed"),
            execution_duration: metrics::histogram!("python_runtime_execution_duration_ms"),
            active_executions: metrics::gauge!("python_runtime_active_executions"),
            pyo3_executions: metrics::counter!("python_runtime_pyo3_executions"),
            wasm_executions: metrics::counter!("python_runtime_wasm_executions"),
            memory_usage: metrics::gauge!("python_runtime_memory_usage_mb"),
        });

        Ok(Self {
            #[cfg(feature = "pyo3")]
            pyo3_runtime,
            #[cfg(feature = "wasm")]
            wasm_runtime,
            scheduler,
            security_manager,
            execution_semaphore,
            active_executions,
            metrics,
        })
    }

    pub async fn execute(&self, request: PythonExecutionRequest) -> Result<PythonExecutionResult> {
        // Acquire execution slot
        let _permit = self.execution_semaphore.acquire().await?;
        
        let start_time = Instant::now();
        self.metrics.total_executions.increment(1);
        
        // Validate code for security
        self.security_manager.validate_code(&request.code, &request.trust_level)?;
        
        // Select runtime based on workload and trust level
        let runtime_type = self.scheduler.select_runtime(&request);
        
        // Track execution
        let execution_context = ExecutionContext {
            runtime_type: runtime_type.clone(),
            started_at: start_time,
            trust_level: request.trust_level.clone(),
        };
        self.active_executions.insert(request.id, execution_context);
        self.metrics.active_executions.set(self.active_executions.len() as f64);
        
        // Execute based on selected runtime
        let result: Result<PythonExecutionResult> = match runtime_type {
            PythonRuntimeType::PyO3 => {
                self.metrics.pyo3_executions.increment(1);
                #[cfg(feature = "pyo3")]
                {
                    self.pyo3_runtime.execute(request.clone()).await
                }
                #[cfg(not(feature = "pyo3"))]
                {
                    #[cfg(feature = "wasm")]
                    {
                        // Fallback to WASM when PyO3 is not available
                        self.metrics.wasm_executions.increment(1);
                        self.wasm_runtime.execute(request.clone()).await
                    }
                    #[cfg(not(feature = "wasm"))]
                    {
                        Err("No Python runtime available (both PyO3 and WASM features are disabled)".into())
                    }
                }
            }
            PythonRuntimeType::Wasm => {
                self.metrics.wasm_executions.increment(1);
                #[cfg(feature = "wasm")]
                {
                    self.wasm_runtime.execute(request.clone()).await
                }
                #[cfg(not(feature = "wasm"))]
                {
                    Err("WASM runtime not available (wasm feature is disabled)".into())
                }
            }
            PythonRuntimeType::Hybrid => {
                // This should not happen as scheduler should resolve to concrete runtime
                return Err("Hybrid runtime not resolved by scheduler".into());
            }
        };
        
        // Clean up execution tracking
        self.active_executions.remove(&request.id);
        self.metrics.active_executions.set(self.active_executions.len() as f64);
        
        // Record metrics
        let execution_time = start_time.elapsed().as_millis() as u64;
        metrics::histogram!("python_runtime_execution_duration_ms").record(execution_time as f64);
        
        match &result {
            Ok(exec_result) => {
                if exec_result.success {
                    metrics::counter!("python_runtime_successful_executions").increment(1);
                } else {
                    metrics::counter!("python_runtime_failed_executions").increment(1);
                }
                
                // Update scheduler with performance data
                let workload_type = self.analyze_workload(&request.code);
                self.scheduler.record_execution_result(
                    runtime_type,
                    workload_type,
                    exec_result.execution_time_ms,
                    exec_result.success
                );
                
                self.metrics.memory_usage.set(exec_result.memory_used_mb as f64);
            }
            Err(_) => {
                metrics::counter!("python_runtime_failed_executions").increment(1);
            }
        }
        
        result
    }

    fn analyze_workload(&self, code: &str) -> crate::scheduler::WorkloadType {
        // Simple workload analysis - in production this would be more sophisticated
        if code.contains("smolagents") || code.contains("transformers") || code.contains("huggingface") {
            crate::scheduler::WorkloadType::MachineLearning
        } else if code.contains("for") && code.contains("range") {
            crate::scheduler::WorkloadType::CpuIntensive
        } else if code.contains("requests") || code.contains("urllib") || code.contains("open") {
            crate::scheduler::WorkloadType::IoIntensive
        } else if code.len() < 100 {
            crate::scheduler::WorkloadType::Simple
        } else {
            crate::scheduler::WorkloadType::Unknown
        }
    }

    pub async fn get_runtime_status(&self) -> RuntimeStatus {
        RuntimeStatus {
            active_executions: self.active_executions.len() as u32,
            total_executions: 0, // Placeholder - metrics crate doesn't have .get() method
            successful_executions: 0, // Placeholder
            failed_executions: 0, // Placeholder
            pyo3_executions: 0, // Placeholder
            wasm_executions: 0, // Placeholder
            current_memory_usage_mb: 0, // Placeholder
            available_slots: self.execution_semaphore.available_permits() as u32,
        }
    }

    pub async fn shutdown(&self) -> Result<()> {
        // Wait for all active executions to complete
        while !self.active_executions.is_empty() {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        
        // Close runtime pools
        // PyO3Runtime and WasmPythonRuntime will be dropped automatically
        
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RuntimeStatus {
    pub active_executions: u32,
    pub total_executions: u64,
    pub successful_executions: u64,
    pub failed_executions: u64,
    pub pyo3_executions: u64,
    pub wasm_executions: u64,
    pub current_memory_usage_mb: u64,
    pub available_slots: u32,
}

impl Drop for PythonRuntimeController {
    fn drop(&mut self) {
        // Ensure all executions are cleaned up
        self.active_executions.clear();
    }
}