use anyhow::{anyhow, Result};
use libc;
use next_rc_shared::{MemoryPool as MemoryPoolTrait, MemorySlot};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicUsize, Ordering};

// eBPF programs are small, so we use smaller slots
const DEFAULT_SLOT_SIZE: usize = 64 * 1024; // 64KB per slot
const DEFAULT_POOL_SIZE: usize = 1000; // 1000 slots = 64MB total

pub struct EbpfMemoryPool {
    slots: Mutex<VecDeque<MemorySlot>>,
    total_slots: usize,
    slot_size: usize,
    available_count: AtomicUsize,
    raw_memory: Vec<Box<[u8]>>,
}

impl EbpfMemoryPool {
    pub fn new(total_slots: usize, slot_size: usize) -> Result<Self> {
        let mut slots = VecDeque::with_capacity(total_slots);
        let mut raw_memory = Vec::with_capacity(total_slots);
        
        // Pre-allocate all memory slots
        for slot_id in 0..total_slots {
            // Allocate aligned memory for eBPF bytecode
            let mut memory = vec![0u8; slot_size].into_boxed_slice();
            
            // Get a non-null pointer to the memory
            let ptr = NonNull::new(memory.as_mut_ptr())
                .ok_or_else(|| anyhow!("Failed to create non-null pointer"))?;
            
            slots.push_back(MemorySlot {
                ptr,
                size: slot_size,
                slot_id,
            });
            
            raw_memory.push(memory);
        }
        
        Ok(Self {
            slots: Mutex::new(slots),
            total_slots,
            slot_size,
            available_count: AtomicUsize::new(total_slots),
            raw_memory,
        })
    }
    
    pub fn with_defaults() -> Result<Self> {
        Self::new(DEFAULT_POOL_SIZE, DEFAULT_SLOT_SIZE)
    }
}

impl MemoryPoolTrait for EbpfMemoryPool {
    fn allocate(&self) -> Result<MemorySlot> {
        let mut slots = self.slots.lock();
        
        if let Some(slot) = slots.pop_front() {
            self.available_count.fetch_sub(1, Ordering::SeqCst);
            Ok(slot)
        } else {
            Err(anyhow!("No available memory slots"))
        }
    }
    
    fn release(&self, slot: MemorySlot) {
        // Clear the memory slot for security
        unsafe {
            // Use libc memset for fast clearing
            libc::memset(
                slot.ptr.as_ptr() as *mut libc::c_void,
                0,
                slot.size,
            );
        }
        
        let mut slots = self.slots.lock();
        slots.push_back(slot);
        self.available_count.fetch_add(1, Ordering::SeqCst);
    }
    
    fn total_slots(&self) -> usize {
        self.total_slots
    }
    
    fn available_slots(&self) -> usize {
        self.available_count.load(Ordering::SeqCst)
    }
}

// Safety: The raw memory is never moved after creation, and we only
// access it through the MemorySlot pointers which are Send + Sync
unsafe impl Send for EbpfMemoryPool {}
unsafe impl Sync for EbpfMemoryPool {}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_memory_pool_allocation() {
        let pool = EbpfMemoryPool::new(10, 4096).unwrap();
        
        assert_eq!(pool.total_slots(), 10);
        assert_eq!(pool.available_slots(), 10);
        
        let slot = pool.allocate().unwrap();
        assert_eq!(pool.available_slots(), 9);
        
        pool.release(slot);
        assert_eq!(pool.available_slots(), 10);
    }
    
    #[test]
    fn test_memory_pool_exhaustion() {
        let pool = EbpfMemoryPool::new(2, 1024).unwrap();
        
        let slot1 = pool.allocate().unwrap();
        let slot2 = pool.allocate().unwrap();
        
        assert!(pool.allocate().is_err());
        
        pool.release(slot1);
        assert!(pool.allocate().is_ok());
        
        pool.release(slot2);
    }
    
    #[test]
    fn test_memory_clearing() {
        let pool = EbpfMemoryPool::new(1, 1024).unwrap();
        
        let mut slot = pool.allocate().unwrap();
        
        // Write some data
        unsafe {
            let slice = std::slice::from_raw_parts_mut(slot.ptr.as_ptr(), slot.size);
            slice.fill(0xFF);
        }
        
        pool.release(slot);
        
        // Allocate again and verify it's cleared
        let slot = pool.allocate().unwrap();
        unsafe {
            let slice = std::slice::from_raw_parts(slot.ptr.as_ptr(), slot.size);
            assert!(slice.iter().all(|&b| b == 0));
        }
        
        pool.release(slot);
    }
}