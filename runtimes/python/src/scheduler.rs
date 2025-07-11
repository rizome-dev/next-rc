use crate::{PythonExecutionRequest, PythonRuntimeType, TrustLevel, Result};
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use metrics::{Counter, Histogram};

pub struct PythonScheduler {
    workload_profiler: Arc<WorkloadProfiler>,
    performance_history: Arc<RwLock<PerformanceHistory>>,
    metrics: Arc<SchedulerMetrics>,
}

struct WorkloadProfiler {
    ml_patterns: Vec<regex::Regex>,
    cpu_intensive_patterns: Vec<regex::Regex>,
    io_intensive_patterns: Vec<regex::Regex>,
    simple_patterns: Vec<regex::Regex>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PerformanceHistory {
    pyo3_avg_time: HashMap<WorkloadType, f64>,
    wasm_avg_time: HashMap<WorkloadType, f64>,
    pyo3_success_rate: HashMap<WorkloadType, f64>,
    wasm_success_rate: HashMap<WorkloadType, f64>,
    total_executions: u64,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkloadType {
    MachineLearning,
    CpuIntensive,
    IoIntensive,
    Simple,
    Unknown,
}

struct SchedulerMetrics {
    scheduling_decisions: Counter,
    pyo3_selections: Counter,
    wasm_selections: Counter,
    scheduling_time: Histogram,
}

impl PythonScheduler {
    pub fn new() -> Result<Self> {
        let workload_profiler = Arc::new(WorkloadProfiler::new()?);
        let performance_history = Arc::new(RwLock::new(PerformanceHistory::new()));
        
        let metrics = Arc::new(SchedulerMetrics {
            scheduling_decisions: metrics::counter!("python_scheduler_decisions_total"),
            pyo3_selections: metrics::counter!("python_scheduler_pyo3_selections_total"),
            wasm_selections: metrics::counter!("python_scheduler_wasm_selections_total"),
            scheduling_time: metrics::histogram!("python_scheduler_decision_time_ms"),
        });

        Ok(Self {
            workload_profiler,
            performance_history,
            metrics,
        })
    }

    pub fn select_runtime(&self, request: &PythonExecutionRequest) -> PythonRuntimeType {
        let start_time = std::time::Instant::now();
        self.metrics.scheduling_decisions.increment(1);

        let runtime = self.select_runtime_internal(request);
        
        match runtime {
            PythonRuntimeType::PyO3 => self.metrics.pyo3_selections.increment(1),
            PythonRuntimeType::Wasm => self.metrics.wasm_selections.increment(1),
            _ => {},
        }

        let decision_time = start_time.elapsed().as_millis() as f64;
        metrics::histogram!("python_scheduler_decision_time_ms").record(decision_time);

        runtime
    }

    fn select_runtime_internal(&self, request: &PythonExecutionRequest) -> PythonRuntimeType {
        // Check explicit runtime hint
        if let Some(runtime_hint) = &request.runtime_hint {
            match runtime_hint {
                PythonRuntimeType::PyO3 | PythonRuntimeType::Wasm => return runtime_hint.clone(),
                PythonRuntimeType::Hybrid => {
                    // Continue with intelligent selection
                }
            }
        }

        // Security-based selection
        match request.trust_level {
            TrustLevel::Low => {
                // Low trust always uses WASM for security
                return PythonRuntimeType::Wasm;
            }
            TrustLevel::Medium => {
                // Medium trust can use PyO3 for performance-critical workloads
                let workload_type = self.workload_profiler.analyze_workload(&request.code);
                if matches!(workload_type, WorkloadType::Simple | WorkloadType::IoIntensive) {
                    return PythonRuntimeType::Wasm;
                }
            }
            TrustLevel::High => {
                // High trust prefers PyO3 for performance
                // Continue with workload analysis
            }
        }

        // Workload-based selection
        let workload_type = self.workload_profiler.analyze_workload(&request.code);
        self.select_runtime_by_workload(workload_type, request)
    }

    fn select_runtime_by_workload(&self, workload_type: WorkloadType, request: &PythonExecutionRequest) -> PythonRuntimeType {
        let history = self.performance_history.read();
        
        match workload_type {
            WorkloadType::MachineLearning => {
                // ML workloads benefit significantly from PyO3 performance
                if request.trust_level == TrustLevel::High {
                    PythonRuntimeType::PyO3
                } else {
                    // Check if PyO3 performance gain justifies the security trade-off
                    let pyo3_avg = history.pyo3_avg_time.get(&workload_type).unwrap_or(&1000.0);
                    let wasm_avg = history.wasm_avg_time.get(&workload_type).unwrap_or(&2000.0);
                    
                    if pyo3_avg * 3.0 < *wasm_avg {
                        PythonRuntimeType::PyO3
                    } else {
                        PythonRuntimeType::Wasm
                    }
                }
            }
            WorkloadType::CpuIntensive => {
                // CPU-intensive workloads strongly favor PyO3
                if request.trust_level != TrustLevel::Low {
                    PythonRuntimeType::PyO3
                } else {
                    PythonRuntimeType::Wasm
                }
            }
            WorkloadType::IoIntensive => {
                // IO-intensive workloads have less performance difference
                PythonRuntimeType::Wasm
            }
            WorkloadType::Simple => {
                // Simple workloads can use WASM for better security
                PythonRuntimeType::Wasm
            }
            WorkloadType::Unknown => {
                // For unknown workloads, use conservative approach
                match request.trust_level {
                    TrustLevel::High => PythonRuntimeType::PyO3,
                    _ => PythonRuntimeType::Wasm,
                }
            }
        }
    }

    pub fn record_execution_result(&self, runtime: PythonRuntimeType, workload_type: WorkloadType, 
                                  execution_time_ms: u64, success: bool) {
        let mut history = self.performance_history.write();
        
        // Update average execution time
        let avg_map = match runtime {
            PythonRuntimeType::PyO3 => &mut history.pyo3_avg_time,
            PythonRuntimeType::Wasm => &mut history.wasm_avg_time,
            _ => return,
        };
        
        let current_avg = avg_map.get(&workload_type).unwrap_or(&0.0);
        let new_avg = (*current_avg + execution_time_ms as f64) / 2.0;
        avg_map.insert(workload_type, new_avg);
        
        // Update success rate
        let success_map = match runtime {
            PythonRuntimeType::PyO3 => &mut history.pyo3_success_rate,
            PythonRuntimeType::Wasm => &mut history.wasm_success_rate,
            _ => return,
        };
        
        let current_rate = success_map.get(&workload_type).unwrap_or(&1.0);
        let new_rate = (*current_rate + if success { 1.0 } else { 0.0 }) / 2.0;
        success_map.insert(workload_type, new_rate);
        
        history.total_executions += 1;
    }
}

impl WorkloadProfiler {
    fn new() -> Result<Self> {
        let ml_patterns = vec![
            regex::Regex::new(r"import\s+(numpy|pandas|sklearn|tensorflow|torch|transformers|huggingface_hub)")?,
            regex::Regex::new(r"from\s+(numpy|pandas|sklearn|tensorflow|torch|transformers|huggingface_hub)")?,
            regex::Regex::new(r"\b(np\.|pd\.|torch\.|tf\.)")?,
            regex::Regex::new(r"\b(neural|network|model|training|prediction|classification|regression)")?,
            regex::Regex::new(r"\b(smolagents|SmolAgent|Agent)")?,
        ];

        let cpu_intensive_patterns = vec![
            regex::Regex::new(r"for\s+\w+\s+in\s+range\([0-9]+\)")?,
            regex::Regex::new(r"while\s+True:")?,
            regex::Regex::new(r"\b(numpy|scipy|numba)")?,
            regex::Regex::new(r"\b(multiprocessing|threading)")?,
            regex::Regex::new(r"\b(sort|search|algorithm)")?,
        ];

        let io_intensive_patterns = vec![
            regex::Regex::new(r"import\s+(requests|urllib|aiohttp|httpx)")?,
            regex::Regex::new(r"open\s*\(")?,
            regex::Regex::new(r"\b(file|read|write|download|upload)")?,
            regex::Regex::new(r"\b(json|xml|csv|database|sql)")?,
        ];

        let simple_patterns = vec![
            regex::Regex::new(r"^[^'\n]*print\s*\(")?,
            regex::Regex::new(r"^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=")?,
            regex::Regex::new(r"^\s*if\s+\w+")?,
            regex::Regex::new(r"^\s*def\s+\w+")?,
        ];

        Ok(Self {
            ml_patterns,
            cpu_intensive_patterns,
            io_intensive_patterns,
            simple_patterns,
        })
    }

    fn analyze_workload(&self, code: &str) -> WorkloadType {
        let mut ml_score = 0;
        let mut cpu_score = 0;
        let mut io_score = 0;
        let mut simple_score = 0;

        // Count pattern matches
        for pattern in &self.ml_patterns {
            ml_score += pattern.find_iter(code).count();
        }
        
        for pattern in &self.cpu_intensive_patterns {
            cpu_score += pattern.find_iter(code).count();
        }
        
        for pattern in &self.io_intensive_patterns {
            io_score += pattern.find_iter(code).count();
        }
        
        for pattern in &self.simple_patterns {
            simple_score += pattern.find_iter(code).count();
        }

        // Weighted scoring (ML and CPU patterns are more significant)
        let ml_weighted = ml_score * 3;
        let cpu_weighted = cpu_score * 2;
        let io_weighted = io_score * 2;
        let simple_weighted = simple_score;

        // Determine workload type
        if ml_weighted > cpu_weighted && ml_weighted > io_weighted {
            WorkloadType::MachineLearning
        } else if cpu_weighted > io_weighted && cpu_weighted > simple_weighted {
            WorkloadType::CpuIntensive
        } else if io_weighted > simple_weighted {
            WorkloadType::IoIntensive
        } else if simple_weighted > 0 {
            WorkloadType::Simple
        } else {
            WorkloadType::Unknown
        }
    }
}

impl PerformanceHistory {
    fn new() -> Self {
        Self {
            pyo3_avg_time: HashMap::new(),
            wasm_avg_time: HashMap::new(),
            pyo3_success_rate: HashMap::new(),
            wasm_success_rate: HashMap::new(),
            total_executions: 0,
        }
    }
}

impl Default for PythonScheduler {
    fn default() -> Self {
        Self::new().expect("Failed to create PythonScheduler")
    }
}