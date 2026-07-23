# NTOX — GPU Thinking

## Purpose

The art of thinking in parallel. GPUs are not just faster CPUs — they are fundamentally different architectures that require different thinking. Understanding GPU architecture is essential for simulation, machine learning, and high-performance computing.

## Core Principle

> GPUs don't do one thing fast.
> They do many things simultaneously.
> Thinking in parallel is thinking differently.
> And thinking differently is thinking better.

## GPU Architecture

### CPU vs GPU
| Feature | CPU | GPU |
|---------|-----|-----|
| Cores | Few (8-64) | Many (thousands) |
| Clock speed | High (3-5 GHz) | Lower (1-2 GHz) |
| Cache | Large | Small |
| Memory | Unified | Distributed |
| Optimization | Latency | Throughput |
| Control flow | Complex | Simple |

### GPU Memory Hierarchy
- **Registers**: Fastest, per-thread
- **Shared memory**: Per-block, fast
- **L1/L2 cache**: Per-chip
- **Global memory**: Slowest, all threads

### GPU Execution Model
- **Threads**: Individual execution units
- **Blocks**: Groups of threads sharing shared memory
- **Grids**: Groups of blocks
- **Warps**: Groups of threads executing in lockstep (32 threads)

## Parallel Thinking Patterns

### Pattern 1: Data Parallelism
Same operation on different data.
```
for each element in array:
    element = transform(element)
```
Perfect for GPU: every thread does the same thing to different data.

### Pattern 2: Task Parallelism
Different operations on different data.
```
thread 1: compute A
thread 2: compute B
thread 3: compute C
```
Harder for GPU: threads must be coordinated.

### Pattern 3: Pipeline Parallelism
Different stages of processing on different data.
```
stage 1 → stage 2 → stage 3
```
Possible on GPU but requires careful memory management.

### Pattern 4: Reduction
Combine many values into one.
```
sum = reduce(array, +)
```
Requires synchronization: parallel reductions are non-trivial.

### Pattern 5: Scan (Prefix Sum)
Compute cumulative operations.
```
output[i] = operation(input[0], input[1], ..., input[i])
```
Fundamental building block for many parallel algorithms.

## GPU Optimization Principles

### 1. Memory Coalescing
Adjacent threads should access adjacent memory locations.
- Misaligned access wastes bandwidth
- Coalesced access maximizes throughput

### 2. Warp Divergence
All threads in a warp execute the same instruction.
- Branches cause divergence
- Divergence reduces performance
- Restructure to minimize branches

### 3. Occupancy
Balance between threads and resources.
- More threads = more latency hiding
- But limited by registers, shared memory
- Optimize for target occupancy

### 4. Avoid Global Memory Access
- Use shared memory when possible
- Cache data in registers
- Minimize memory transfers

### 5. Minimize Synchronization
- Synchronization is expensive
- Use atomic operations when possible
- Batch synchronization points

## GPU Applications

| Application | Why GPU |
|-------------|---------|
| **Deep learning** | Matrix operations are massively parallel |
| **Simulation** | Particle systems, fluid dynamics, N-body |
| **Image processing** | Pixel-level operations are parallel |
| **Cryptocurrency mining** | Hash operations are parallel |
| **Scientific computing** | Large-scale numerical computation |
| **Ray tracing** | Per-pixel operations are parallel |

## Common GPU Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Race conditions** | Threads access shared data unsynchronized | Use atomics, synchronization |
| **Warp divergence** | Branches cause threads to diverge | Restructure logic |
| **Memory bank conflicts** | Threads access same bank | Restructure access patterns |
| **Insufficient occupancy** | Too few threads to hide latency | Increase parallelism |
| **Excessive global memory** | Slow memory access | Use shared memory |
| **Synchronization overhead** | Too many barriers | Reduce synchronization |

## Integration With Other Modules

- **Simulation Engine**: GPUs enable large-scale simulation
- **Mathematical Thinking**: GPU algorithms require mathematical understanding
- **Architecture**: GPU architecture is a special case of software architecture
- **Engineering Reality**: GPU constraints must be considered in design
- **Optimization**: GPU optimization is a form of optimization
- **Discovery Engine**: GPUs enable previously impossible computations

## The GPU Thinking Mantra

> Think in parallel, not in sequence.
> Think in warps, not in threads.
> Think in memory, not in computation.
> Because on a GPU, memory is the bottleneck.
> And computation is cheap.
> But only if you can feed it fast enough.
