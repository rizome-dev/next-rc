use crate::{
    AgentWorkflowRequest, AgentWorkflowResult, AgentStep, ModelConfig,
    PythonExecutionRequest, PythonRuntimeController, TrustLevel, Result
};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use serde_json::{json, Value};
use tokio::time::timeout;
use metrics::{Counter, Histogram, Gauge};

pub struct SmolAgentsRunner {
    python_runtime: Arc<PythonRuntimeController>,
    metrics: Arc<AgentMetrics>,
}

struct AgentMetrics {
    workflow_executions: Counter,
    successful_workflows: Counter,
    failed_workflows: Counter,
    workflow_duration: Histogram,
    total_steps: Counter,
    tool_usage: Counter,
    tokens_used: Counter,
}

impl SmolAgentsRunner {
    pub fn new(python_runtime: Arc<PythonRuntimeController>) -> Self {
        let metrics = Arc::new(AgentMetrics {
            workflow_executions: metrics::counter!("smolagents_workflow_executions_total"),
            successful_workflows: metrics::counter!("smolagents_workflow_executions_successful"),
            failed_workflows: metrics::counter!("smolagents_workflow_executions_failed"),
            workflow_duration: metrics::histogram!("smolagents_workflow_duration_ms"),
            total_steps: metrics::counter!("smolagents_workflow_steps_total"),
            tool_usage: metrics::counter!("smolagents_tool_usage_total"),
            tokens_used: metrics::counter!("smolagents_tokens_used_total"),
        });

        Self {
            python_runtime,
            metrics,
        }
    }

    pub async fn run_workflow(&self, request: AgentWorkflowRequest) -> Result<AgentWorkflowResult> {
        let start_time = Instant::now();
        self.metrics.workflow_executions.increment(1);

        // Generate Python code for the smolagents workflow
        let python_code = self.generate_agent_code(&request)?;
        
        // Create execution request
        let execution_request = PythonExecutionRequest {
            id: request.id,
            code: python_code,
            runtime_hint: Some(crate::PythonRuntimeType::PyO3), // Prefer PyO3 for ML workloads
            trust_level: TrustLevel::High, // AI agents need broader permissions
            timeout_ms: request.timeout_ms,
            memory_limit_mb: 1024, // Give generous memory for AI workloads
            environment: self.create_environment(&request.model_config),
            requirements: vec![
                "smolagents".to_string(),
                "transformers".to_string(),
                "torch".to_string(),
                "requests".to_string(),
                "numpy".to_string(),
            ],
        };

        // Execute the workflow
        let execution_result = timeout(
            Duration::from_millis(request.timeout_ms),
            self.python_runtime.execute(execution_request)
        ).await??;

        let execution_time = start_time.elapsed().as_millis() as u64;
        self.metrics.workflow_duration.record(execution_time as f64);

        if execution_result.success {
            self.metrics.successful_workflows.increment(1);
            
            // Parse the result
            let workflow_result = self.parse_workflow_result(&execution_result.output)?;
            
            // Update metrics
            self.metrics.total_steps.increment(workflow_result.intermediate_steps.len() as u64);
            self.metrics.tokens_used.increment(workflow_result.tokens_used as u64);
            
            Ok(AgentWorkflowResult {
                id: request.id,
                success: true,
                final_output: workflow_result.final_output,
                intermediate_steps: workflow_result.intermediate_steps,
                execution_time_ms: execution_time,
                tokens_used: workflow_result.tokens_used,
                error: None,
            })
        } else {
            self.metrics.failed_workflows.increment(1);
            
            Ok(AgentWorkflowResult {
                id: request.id,
                success: false,
                final_output: Value::Null,
                intermediate_steps: vec![],
                execution_time_ms: execution_time,
                tokens_used: 0,
                error: execution_result.error,
            })
        }
    }

    fn generate_agent_code(&self, request: &AgentWorkflowRequest) -> Result<String> {
        let input_data_json = serde_json::to_string(&request.input_data)?;
        let tools_json = serde_json::to_string(&request.tools)?;
        
        let code = format!(r#"
import json
import sys
import traceback
from typing import Dict, Any, List
from smolagents import CodeAgent, HfApiModel, DuckDuckGoSearchTool, PythonInterpreterTool
from smolagents.agents import Agent
from smolagents.tools import Tool
import torch
import numpy as np

# Configure the model
model_config = {{
    "model_name": "{}",
    "api_key": "{}",
    "base_url": "{}",
    "max_tokens": {},
    "temperature": {}
}}

# Initialize the model
if model_config["api_key"]:
    model = HfApiModel(
        model_id=model_config["model_name"],
        token=model_config["api_key"]
    )
else:
    # Use a default model if no API key provided
    model = HfApiModel(model_id="microsoft/DialoGPT-medium")

# Initialize tools
available_tools = []
requested_tools = {}

for tool_name in requested_tools:
    if tool_name == "search":
        available_tools.append(DuckDuckGoSearchTool())
    elif tool_name == "python":
        available_tools.append(PythonInterpreterTool())
    elif tool_name == "calculator":
        # Add calculator tool if available
        pass

# Create the agent
agent = CodeAgent(
    tools=available_tools,
    model=model,
    max_iterations={}
)

# Input data
input_data = {}

# Custom agent code
try:
    # Execute the user's agent code
    {}
    
    # If no explicit result, use the last agent response
    if 'result' not in locals():
        result = agent.run("Process the input data and provide a meaningful response.")
    
    # Format the output
    workflow_result = {{
        "success": True,
        "final_output": result,
        "intermediate_steps": [],
        "tokens_used": 0,
        "error": None
    }}
    
    print("WORKFLOW_RESULT_START")
    print(json.dumps(workflow_result, indent=2))
    print("WORKFLOW_RESULT_END")
    
except Exception as e:
    error_result = {{
        "success": False,
        "final_output": None,
        "intermediate_steps": [],
        "tokens_used": 0,
        "error": str(e)
    }}
    
    print("WORKFLOW_RESULT_START")
    print(json.dumps(error_result, indent=2))
    print("WORKFLOW_RESULT_END")
    
    traceback.print_exc()
"#,
            request.model_config.model_name,
            request.model_config.api_key.as_deref().unwrap_or(""),
            request.model_config.base_url.as_deref().unwrap_or(""),
            request.model_config.max_tokens.unwrap_or(1024),
            request.model_config.temperature.unwrap_or(0.7),
            tools_json,
            request.max_iterations,
            input_data_json,
            request.agent_code
        );

        Ok(code)
    }

    fn create_environment(&self, model_config: &ModelConfig) -> std::collections::HashMap<String, String> {
        let mut env = std::collections::HashMap::new();
        
        if let Some(api_key) = &model_config.api_key {
            env.insert("HF_TOKEN".to_string(), api_key.clone());
            env.insert("HUGGING_FACE_HUB_TOKEN".to_string(), api_key.clone());
        }
        
        if let Some(base_url) = &model_config.base_url {
            env.insert("HF_HUB_BASE_URL".to_string(), base_url.clone());
        }
        
        // Set up common environment variables for AI workloads
        env.insert("PYTHONPATH".to_string(), "/usr/local/lib/python3.9/site-packages".to_string());
        env.insert("CUDA_VISIBLE_DEVICES".to_string(), "0".to_string());
        env.insert("TOKENIZERS_PARALLELISM".to_string(), "false".to_string());
        
        env
    }

    fn parse_workflow_result(&self, output: &str) -> Result<WorkflowResult> {
        // Look for the result markers
        let start_marker = "WORKFLOW_RESULT_START";
        let end_marker = "WORKFLOW_RESULT_END";
        
        if let Some(start_pos) = output.find(start_marker) {
            let start_pos = start_pos + start_marker.len();
            
            if let Some(end_pos) = output[start_pos..].find(end_marker) {
                let json_str = &output[start_pos..start_pos + end_pos].trim();
                
                let parsed: Value = serde_json::from_str(json_str)?;
                
                return Ok(WorkflowResult {
                    final_output: parsed["final_output"].clone(),
                    intermediate_steps: self.parse_intermediate_steps(&parsed["intermediate_steps"])?,
                    tokens_used: parsed["tokens_used"].as_u64().unwrap_or(0) as u32,
                });
            }
        }
        
        // Fallback: treat entire output as result
        Ok(WorkflowResult {
            final_output: Value::String(output.to_string()),
            intermediate_steps: vec![],
            tokens_used: 0,
        })
    }

    fn parse_intermediate_steps(&self, steps_value: &Value) -> Result<Vec<AgentStep>> {
        let mut steps = Vec::new();
        
        if let Value::Array(steps_array) = steps_value {
            for (i, step_value) in steps_array.iter().enumerate() {
                if let Value::Object(step_obj) = step_value {
                    let step = AgentStep {
                        step_id: i as u32,
                        tool_used: step_obj.get("tool_used")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        input: step_obj.get("input").cloned().unwrap_or(Value::Null),
                        output: step_obj.get("output").cloned().unwrap_or(Value::Null),
                        timestamp: SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    };
                    steps.push(step);
                }
            }
        }
        
        Ok(steps)
    }

    pub async fn get_agent_status(&self) -> AgentStatus {
        AgentStatus {
            total_workflows: 0, // Placeholder - metrics crate doesn't have .get() method
            successful_workflows: 0, // Placeholder
            failed_workflows: 0, // Placeholder
            total_steps: 0, // Placeholder
            total_tokens_used: 0, // Placeholder
            tool_usage_count: 0, // Placeholder
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentStatus {
    pub total_workflows: u64,
    pub successful_workflows: u64,
    pub failed_workflows: u64,
    pub total_steps: u64,
    pub total_tokens_used: u64,
    pub tool_usage_count: u64,
}

#[derive(Debug)]
struct WorkflowResult {
    final_output: Value,
    intermediate_steps: Vec<AgentStep>,
    tokens_used: u32,
}

// Example usage and test functions
impl SmolAgentsRunner {
    pub async fn run_simple_example(&self) -> Result<AgentWorkflowResult> {
        let request = AgentWorkflowRequest {
            id: Uuid::new_v4(),
            agent_code: r#"
# Simple example: analyze some data
import json

data = input_data.get("numbers", [1, 2, 3, 4, 5])
result = {
    "sum": sum(data),
    "average": sum(data) / len(data),
    "max": max(data),
    "min": min(data),
    "analysis": f"Analyzed {len(data)} numbers with sum={sum(data)}"
}
"#.to_string(),
            input_data: json!({
                "numbers": [10, 20, 30, 40, 50]
            }),
            model_config: ModelConfig {
                model_name: "microsoft/DialoGPT-medium".to_string(),
                api_key: None,
                base_url: None,
                max_tokens: Some(512),
                temperature: Some(0.7),
            },
            tools: vec!["python".to_string()],
            max_iterations: 5,
            timeout_ms: 30000,
        };

        self.run_workflow(request).await
    }

    pub async fn run_search_example(&self) -> Result<AgentWorkflowResult> {
        let request = AgentWorkflowRequest {
            id: Uuid::new_v4(),
            agent_code: r#"
# Search example: find information about a topic
query = input_data.get("query", "latest developments in AI")
result = agent.run(f"Search for information about: {query}")
"#.to_string(),
            input_data: json!({
                "query": "latest developments in large language models"
            }),
            model_config: ModelConfig {
                model_name: "microsoft/DialoGPT-medium".to_string(),
                api_key: None,
                base_url: None,
                max_tokens: Some(1024),
                temperature: Some(0.7),
            },
            tools: vec!["search".to_string(), "python".to_string()],
            max_iterations: 10,
            timeout_ms: 60000,
        };

        self.run_workflow(request).await
    }
}