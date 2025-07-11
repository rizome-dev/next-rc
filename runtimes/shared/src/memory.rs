use anyhow::Result;
use std::ptr::NonNull;

#[derive(Debug, Clone)]
pub struct MemorySlot {
    pub ptr: NonNull<u8>,
    pub size: usize,
    pub slot_id: usize,
}

unsafe impl Send for MemorySlot {}
unsafe impl Sync for MemorySlot {}

pub trait MemoryPool: Send + Sync {
    fn allocate(&self) -> Result<MemorySlot>;
    fn release(&self, slot: MemorySlot);
    fn total_slots(&self) -> usize;
    fn available_slots(&self) -> usize;
}

#[derive(Debug, Clone)]
pub struct SharedRegion {
    pub base_addr: usize,
    pub size: usize,
    pub permissions: MemoryPermissions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryPermissions {
    ReadOnly,
    ReadWrite,
    Execute,
    ReadExecute,
}

impl MemoryPermissions {
    pub fn to_mmap_prot(&self) -> libc::c_int {
        match self {
            MemoryPermissions::ReadOnly => libc::PROT_READ,
            MemoryPermissions::ReadWrite => libc::PROT_READ | libc::PROT_WRITE,
            MemoryPermissions::Execute => libc::PROT_EXEC,
            MemoryPermissions::ReadExecute => libc::PROT_READ | libc::PROT_EXEC,
        }
    }
}