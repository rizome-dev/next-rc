use crate::{PythonExecutionRequest, PythonExecutionResult, PythonRuntimeType, TrustLevel, Result};
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyModule, PyString};
use pyo3_asyncio::tokio::future_into_py;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use dashmap::DashMap;
use uuid::Uuid;
use tokio::time::timeout;
use metrics::{Counter, Histogram, Gauge};

pub struct PyO3Runtime {
    interpreters: Arc<DashMap<Uuid, Arc<RwLock<PythonInterpreter>>>>,
    security_manager: Arc<crate::security::SecurityManager>,
    metrics: Arc<PyO3Metrics>,
}

struct PythonInterpreter {
    py: Python<'static>,
    globals: HashMap<String, Py<PyAny>>,
    modules: HashMap<String, Py<PyModule>>,
    memory_usage: usize,
    created_at: Instant,
}

struct PyO3Metrics {
    execution_count: Counter,
    execution_duration: Histogram,
    memory_usage: Gauge,
    active_interpreters: Gauge,
}

impl PyO3Runtime {
    pub fn new(security_manager: Arc<crate::security::SecurityManager>) -> Result<Self> {
        // Initialize PyO3 with free-threading support
        pyo3::prepare_freethreaded_python();
        
        let metrics = Arc::new(PyO3Metrics {
            execution_count: metrics::counter!("python_pyo3_executions_total"),
            execution_duration: metrics::histogram!("python_pyo3_execution_duration_ms"),
            memory_usage: metrics::gauge!("python_pyo3_memory_usage_mb"),
            active_interpreters: metrics::gauge!("python_pyo3_active_interpreters"),
        });

        Ok(Self {
            interpreters: Arc::new(DashMap::new()),
            security_manager,
            metrics,
        })
    }

    pub async fn execute(&self, request: PythonExecutionRequest) -> Result<PythonExecutionResult> {
        let start_time = Instant::now();
        self.metrics.execution_count.increment(1);

        // Apply security restrictions based on trust level
        let restrictions = self.security_manager.get_restrictions(&request.trust_level);
        
        // Get or create interpreter for this request
        let interpreter = self.get_or_create_interpreter(&request).await?;
        
        // Execute with timeout
        let execution_future = self.execute_with_interpreter(interpreter, &request);
        let execution_result = timeout(
            Duration::from_millis(request.timeout_ms),
            execution_future
        ).await??;

        let execution_time = start_time.elapsed().as_millis() as u64;
        metrics::histogram!("python_pyo3_execution_duration_ms").record(execution_time as f64);

        Ok(PythonExecutionResult {
            id: request.id,
            success: execution_result.success,
            output: execution_result.output,
            error: execution_result.error,
            runtime_used: PythonRuntimeType::PyO3,
            execution_time_ms: execution_time,
            memory_used_mb: execution_result.memory_used_mb,
            exit_code: execution_result.exit_code,
        })
    }

    async fn get_or_create_interpreter(&self, request: &PythonExecutionRequest) -> Result<Arc<RwLock<PythonInterpreter>>> {
        // Create a new interpreter for each request (isolation)
        let interpreter_id = Uuid::new_v4();
        
        let interpreter = Arc::new(RwLock::new(
            self.create_interpreter(request).await?
        ));
        
        self.interpreters.insert(interpreter_id, interpreter.clone());
        self.metrics.active_interpreters.set(self.interpreters.len() as f64);
        
        Ok(interpreter)
    }

    async fn create_interpreter(&self, request: &PythonExecutionRequest) -> Result<PythonInterpreter> {
        Python::with_gil(|py| {
            let sys = py.import("sys")?;
            let os = py.import("os")?;
            
            // Set up environment variables
            let env = os.getattr("environ")?;
            for (key, value) in &request.environment {
                env.set_item(key, value)?;
            }
            
            // Install requirements if specified
            if !request.requirements.is_empty() {
                self.install_requirements(py, &request.requirements)?;
            }
            
            // Create isolated globals
            let globals = PyDict::new(py);
            globals.set_item("__name__", "__main__")?;
            globals.set_item("__builtins__", py.import("builtins")?)?;
            
            // Add common imports for AI/ML workloads
            self.setup_common_imports(py, globals)?;
            
            Ok(PythonInterpreter {
                py: unsafe { std::mem::transmute(py) }, // Extend lifetime
                globals: HashMap::new(),
                modules: HashMap::new(),
                memory_usage: 0,
                created_at: Instant::now(),
            })
        })
    }

    fn setup_common_imports(&self, py: Python, globals: &PyDict) -> PyResult<()> {
        // Pre-import commonly used modules for AI/ML
        let imports = vec![
            ("numpy", "np"),
            ("pandas", "pd"),
            ("json", "json"),
            ("os", "os"),
            ("sys", "sys"),
            ("datetime", "datetime"),
            ("typing", "typing"),
            ("asyncio", "asyncio"),
        ];
        
        for (module_name, alias) in imports {
            if let Ok(module) = py.import(module_name) {
                globals.set_item(alias, module)?;
            }
        }
        
        Ok(())
    }

    fn install_requirements(&self, py: Python, requirements: &[String]) -> PyResult<()> {
        let subprocess = py.import("subprocess")?;
        
        for requirement in requirements {
            // Use pip to install requirement
            let args = vec![
                "pip", "install", "--user", "--quiet", requirement
            ];
            
            let result = subprocess.call_method1(
                "run", 
                (args, py.None(), py.None())
            )?;
            
            // Check if installation was successful
            let returncode = result.getattr("returncode")?;
            if returncode.extract::<i32>()? != 0 {
                return Err(PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(
                    format!("Failed to install requirement: {}", requirement)
                ));
            }
        }
        
        Ok(())
    }

    async fn execute_with_interpreter(
        &self,
        interpreter: Arc<RwLock<PythonInterpreter>>,
        request: &PythonExecutionRequest
    ) -> Result<ExecutionResult> {
        let code = request.code.clone();
        let memory_limit = request.memory_limit_mb;
        
        // Execute in thread pool to avoid blocking
        let result = tokio::task::spawn_blocking(move || {
            let interpreter = interpreter.read();
            
            Python::with_gil(|py| {
                // Set memory limit
                Self::set_memory_limit(py, memory_limit)?;
                
                // Create execution globals
                let globals = PyDict::new(py);
                globals.set_item("__name__", "__main__")?;
                globals.set_item("__builtins__", py.import("builtins")?)?;
                
                // Capture stdout/stderr
                let io = py.import("io")?;
                let stdout = io.call_method0("StringIO")?;
                let stderr = io.call_method0("StringIO")?;
                
                let sys = py.import("sys")?;
                let old_stdout = sys.getattr("stdout")?;
                let old_stderr = sys.getattr("stderr")?;
                
                sys.setattr("stdout", stdout)?;
                sys.setattr("stderr", stderr)?;
                
                // Execute the code
                let exec_result = py.run(&code, Some(globals), None);
                
                // Restore stdout/stderr
                sys.setattr("stdout", old_stdout)?;
                sys.setattr("stderr", old_stderr)?;
                
                // Get output
                let output = stdout.call_method0("getvalue")?.extract::<String>()?;
                let error_output = stderr.call_method0("getvalue")?.extract::<String>()?;
                
                // Get memory usage
                let memory_used = Self::get_memory_usage(py)?;
                
                match exec_result {
                    Ok(_) => Ok::<ExecutionResult, anyhow::Error>(ExecutionResult {
                        success: true,
                        output,
                        error: if error_output.is_empty() { None } else { Some(error_output) },
                        memory_used_mb: memory_used,
                        exit_code: Some(0),
                    }),
                    Err(e) => Ok::<ExecutionResult, anyhow::Error>(ExecutionResult {
                        success: false,
                        output,
                        error: Some(format!("{}\n{}", e, error_output)),
                        memory_used_mb: memory_used,
                        exit_code: Some(1),
                    }),
                }
            })
        }).await??;
        
        Ok(result)
    }

    fn set_memory_limit(py: Python, limit_mb: u64) -> PyResult<()> {
        let resource = py.import("resource")?;
        let rlimit_as = resource.getattr("RLIMIT_AS")?;
        let limit_bytes = (limit_mb * 1024 * 1024) as u64;
        
        resource.call_method1("setrlimit", (rlimit_as, (limit_bytes, limit_bytes)))?;
        Ok(())
    }

    fn get_memory_usage(py: Python) -> PyResult<u64> {
        let resource = py.import("resource")?;
        let rusage = resource.call_method1("getrusage", (resource.getattr("RUSAGE_SELF")?,))?;
        let ru_maxrss = rusage.getattr("ru_maxrss")?.extract::<u64>()?;
        
        // Convert from KB to MB (on Linux ru_maxrss is in KB)
        Ok(ru_maxrss / 1024)
    }

    pub async fn cleanup_interpreter(&self, interpreter_id: &Uuid) -> Result<()> {
        if let Some((_, interpreter)) = self.interpreters.remove(interpreter_id) {
            // Interpreter will be dropped automatically
            self.metrics.active_interpreters.set(self.interpreters.len() as f64);
        }
        Ok(())
    }
}

#[derive(Debug)]
struct ExecutionResult {
    success: bool,
    output: String,
    error: Option<String>,
    memory_used_mb: u64,
    exit_code: Option<i32>,
}

unsafe impl Send for PythonInterpreter {}
unsafe impl Sync for PythonInterpreter {}

impl Drop for PyO3Runtime {
    fn drop(&mut self) {
        // Clean up all interpreters
        self.interpreters.clear();
    }
}