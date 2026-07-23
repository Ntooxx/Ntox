# Programming — Operating Systems

## Purpose

The foundation of all software. Understanding operating systems is understanding how computers actually work. Memory, processes, threads, file systems, and system calls are the building blocks of all programs.

## Core Principle

> The operating system is the government of the computer.
> It manages resources.
> It enforces rules.
> It provides services.
> Understanding it is understanding how software actually runs.

## OS Concepts

### Processes
- Instance of a program
- Has its own memory space
- Created by fork/exec
- Managed by scheduler
- Communicate via IPC

### Threads
- Unit of execution within a process
- Share memory space
- Lightweight compared to processes
- Concurrent execution
- Synchronization needed

### Memory Management
- Virtual memory
- Paging
- Segmentation
- Page replacement algorithms
- Memory-mapped files

### File Systems
- Hierarchical directory structure
- File permissions
- Journaling
- File system types (ext4, NTFS, APFS)
- Virtual file system

### System Calls
- Process control (fork, exec, exit)
- File operations (open, read, write)
- Device management
- Information maintenance
- Communication (pipe, socket)

## Concurrency

### Synchronization Primitives
| Primitive | Purpose |
|-----------|---------|
| **Mutex** | Mutual exclusion |
| **Semaphore** | Counting synchronization |
| **Condition variable** | Wait for condition |
| **Barrier** | Synchronize threads |
| **Read-write lock** | Concurrent reads, exclusive writes |

### Deadlock
- Mutual exclusion
- Hold and wait
- No preemption
- Circular wait

### Prevention
- Lock ordering
- Timeout
- Deadlock detection
- Avoidance algorithms

## Process Scheduling

| Algorithm | Description |
|-----------|-------------|
| **FCFS** | First come, first served |
| **SJF** | Shortest job first |
| **Round Robin** | Time slices |
| **Priority** | Priority-based |
| **Multilevel** | Multiple queues |

## Common OS Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Memory leak** | Not freeing memory | Use RAII, smart pointers |
| **Deadlock** | Threads waiting forever | Lock ordering |
| **Race condition** | Unsynchronized access | Use synchronization |
| **Buffer overflow** | Writing past buffer | Bounds checking |
| **Null pointer** | Dereferencing null | Check before use |
| **File handle leak** | Not closing files | Use context managers |

## Integration

- **Networking**: OS provides networking
- **Security**: OS enforces security
- **Performance**: OS affects performance
- **Concurrency**: OS manages concurrency
- **Memory**: OS manages memory
- **Storage**: OS manages storage

## Mantra

> The operating system is the foundation.
> Understanding it is understanding
> how software actually runs.
> Processes, threads, memory, files.
> These are the building blocks.
> Learn them well.
> Because everything else is built on top.
