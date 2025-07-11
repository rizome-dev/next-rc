use crate::{TrustLevel, Result};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
use nix::sys::signal::{self, Signal};
#[cfg(target_os = "linux")]
use nix::unistd::{fork, ForkResult};
#[cfg(target_os = "linux")]
use seccomp::{SeccompFilter, SeccompRule, SeccompCondition, SeccompAction};

pub struct SecurityManager {
    restrictions: HashMap<TrustLevel, SecurityRestrictions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityRestrictions {
    pub max_memory_mb: u64,
    pub max_execution_time_ms: u64,
    pub allowed_imports: Vec<String>,
    pub blocked_imports: Vec<String>,
    pub allowed_functions: Vec<String>,
    pub blocked_functions: Vec<String>,
    pub network_access: bool,
    pub file_system_access: bool,
    pub subprocess_access: bool,
    pub use_seccomp: bool,
    pub use_namespaces: bool,
}

impl SecurityManager {
    pub fn new() -> Result<Self> {
        let mut restrictions = HashMap::new();
        
        // Low trust - Maximum security
        restrictions.insert(TrustLevel::Low, SecurityRestrictions {
            max_memory_mb: 128,
            max_execution_time_ms: 30000, // 30 seconds
            allowed_imports: vec![
                "json".to_string(),
                "math".to_string(),
                "random".to_string(),
                "datetime".to_string(),
                "re".to_string(),
                "string".to_string(),
                "collections".to_string(),
                "itertools".to_string(),
            ],
            blocked_imports: vec![
                "os".to_string(),
                "sys".to_string(),
                "subprocess".to_string(),
                "socket".to_string(),
                "urllib".to_string(),
                "requests".to_string(),
                "http".to_string(),
                "__import__".to_string(),
                "eval".to_string(),
                "exec".to_string(),
            ],
            allowed_functions: vec![
                "print".to_string(),
                "len".to_string(),
                "range".to_string(),
                "enumerate".to_string(),
                "zip".to_string(),
                "map".to_string(),
                "filter".to_string(),
                "sorted".to_string(),
                "sum".to_string(),
                "min".to_string(),
                "max".to_string(),
            ],
            blocked_functions: vec![
                "open".to_string(),
                "input".to_string(),
                "eval".to_string(),
                "exec".to_string(),
                "compile".to_string(),
                "__import__".to_string(),
                "getattr".to_string(),
                "setattr".to_string(),
                "delattr".to_string(),
                "globals".to_string(),
                "locals".to_string(),
                "vars".to_string(),
                "dir".to_string(),
            ],
            network_access: false,
            file_system_access: false,
            subprocess_access: false,
            use_seccomp: true,
            use_namespaces: true,
        });

        // Medium trust - Balanced security and functionality
        restrictions.insert(TrustLevel::Medium, SecurityRestrictions {
            max_memory_mb: 512,
            max_execution_time_ms: 120000, // 2 minutes
            allowed_imports: vec![
                "json".to_string(),
                "math".to_string(),
                "random".to_string(),
                "datetime".to_string(),
                "re".to_string(),
                "string".to_string(),
                "collections".to_string(),
                "itertools".to_string(),
                "numpy".to_string(),
                "pandas".to_string(),
                "requests".to_string(),
                "urllib".to_string(),
                "transformers".to_string(),
                "huggingface_hub".to_string(),
                "smolagents".to_string(),
            ],
            blocked_imports: vec![
                "os".to_string(),
                "sys".to_string(),
                "subprocess".to_string(),
                "socket".to_string(),
                "__import__".to_string(),
            ],
            allowed_functions: vec![
                "print".to_string(),
                "len".to_string(),
                "range".to_string(),
                "enumerate".to_string(),
                "zip".to_string(),
                "map".to_string(),
                "filter".to_string(),
                "sorted".to_string(),
                "sum".to_string(),
                "min".to_string(),
                "max".to_string(),
                "open".to_string(),
            ],
            blocked_functions: vec![
                "eval".to_string(),
                "exec".to_string(),
                "compile".to_string(),
                "__import__".to_string(),
                "globals".to_string(),
                "locals".to_string(),
                "vars".to_string(),
            ],
            network_access: true,
            file_system_access: true,
            subprocess_access: false,
            use_seccomp: true,
            use_namespaces: false,
        });

        // High trust - Maximum performance, minimal restrictions
        restrictions.insert(TrustLevel::High, SecurityRestrictions {
            max_memory_mb: 2048,
            max_execution_time_ms: 300000, // 5 minutes
            allowed_imports: vec![], // All imports allowed
            blocked_imports: vec![], // No imports blocked
            allowed_functions: vec![], // All functions allowed
            blocked_functions: vec![], // No functions blocked
            network_access: true,
            file_system_access: true,
            subprocess_access: true,
            use_seccomp: false,
            use_namespaces: false,
        });

        Ok(Self { restrictions })
    }

    pub fn get_restrictions(&self, trust_level: &TrustLevel) -> &SecurityRestrictions {
        self.restrictions.get(trust_level)
            .expect("Trust level not found in restrictions")
    }

    pub fn create_sandbox(&self, trust_level: &TrustLevel) -> Result<SandboxContext> {
        let restrictions = self.get_restrictions(trust_level);
        
        #[cfg(target_os = "linux")]
        {
            if restrictions.use_namespaces {
                return self.create_namespace_sandbox(restrictions);
            }
        }
        
        Ok(SandboxContext {
            restrictions: restrictions.clone(),
            #[cfg(target_os = "linux")]
            seccomp_filter: None,
        })
    }

    #[cfg(target_os = "linux")]
    fn create_namespace_sandbox(&self, restrictions: &SecurityRestrictions) -> Result<SandboxContext> {
        use nix::sched::{unshare, CloneFlags};
        use nix::mount::{mount, MsFlags};
        use std::ffi::CString;

        // Create new namespaces
        let mut flags = CloneFlags::CLONE_NEWPID | CloneFlags::CLONE_NEWNS;
        
        if !restrictions.network_access {
            flags |= CloneFlags::CLONE_NEWNET;
        }
        
        if !restrictions.file_system_access {
            flags |= CloneFlags::CLONE_NEWNS;
        }
        
        unshare(flags)?;

        // Set up seccomp filter if required
        let seccomp_filter = if restrictions.use_seccomp {
            Some(self.create_seccomp_filter(restrictions)?)
        } else {
            None
        };

        Ok(SandboxContext {
            restrictions: restrictions.clone(),
            seccomp_filter,
        })
    }

    #[cfg(target_os = "linux")]
    fn create_seccomp_filter(&self, restrictions: &SecurityRestrictions) -> Result<SeccompFilter> {
        let mut filter = SeccompFilter::new();
        
        // Allow basic system calls
        filter.add_rule(SeccompRule::new(
            libc::SYS_read,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_write,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_mmap,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_munmap,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_brk,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_exit,
            vec![],
            SeccompAction::Allow,
        )?)?;
        
        filter.add_rule(SeccompRule::new(
            libc::SYS_exit_group,
            vec![],
            SeccompAction::Allow,
        )?)?;

        // Block dangerous system calls
        if !restrictions.network_access {
            filter.add_rule(SeccompRule::new(
                libc::SYS_socket,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
            
            filter.add_rule(SeccompRule::new(
                libc::SYS_connect,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
        }
        
        if !restrictions.file_system_access {
            filter.add_rule(SeccompRule::new(
                libc::SYS_open,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
            
            filter.add_rule(SeccompRule::new(
                libc::SYS_openat,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
        }
        
        if !restrictions.subprocess_access {
            filter.add_rule(SeccompRule::new(
                libc::SYS_fork,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
            
            filter.add_rule(SeccompRule::new(
                libc::SYS_execve,
                vec![],
                SeccompAction::Errno(libc::EACCES),
            )?)?;
        }

        Ok(filter)
    }

    pub fn validate_code(&self, code: &str, trust_level: &TrustLevel) -> Result<()> {
        let restrictions = self.get_restrictions(trust_level);
        
        // Check for blocked imports
        for blocked_import in &restrictions.blocked_imports {
            if code.contains(&format!("import {}", blocked_import)) ||
               code.contains(&format!("from {}", blocked_import)) {
                return Err(format!("Blocked import detected: {}", blocked_import).into());
            }
        }
        
        // Check for blocked functions
        for blocked_function in &restrictions.blocked_functions {
            if code.contains(&format!("{}(", blocked_function)) {
                return Err(format!("Blocked function detected: {}", blocked_function).into());
            }
        }
        
        // Check for dangerous patterns
        let dangerous_patterns = vec![
            "__import__",
            "eval(",
            "exec(",
            "compile(",
            "globals(",
            "locals(",
            "getattr(",
            "setattr(",
            "delattr(",
        ];
        
        for pattern in dangerous_patterns {
            if code.contains(pattern) {
                return Err(format!("Dangerous pattern detected: {}", pattern).into());
            }
        }
        
        Ok(())
    }
}

pub struct SandboxContext {
    pub restrictions: SecurityRestrictions,
    #[cfg(target_os = "linux")]
    pub seccomp_filter: Option<SeccompFilter>,
}

impl SandboxContext {
    pub fn activate(&self) -> Result<()> {
        #[cfg(target_os = "linux")]
        {
            if let Some(filter) = &self.seccomp_filter {
                filter.load()?;
            }
        }
        
        Ok(())
    }
}

impl Default for SecurityManager {
    fn default() -> Self {
        Self::new().expect("Failed to create SecurityManager")
    }
}