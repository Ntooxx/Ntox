# Programming — Performance Optimization

## Purpose

The practice of making software faster, smaller, and more efficient. Not premature optimization — systematic improvement based on measurement. Profile first, optimize second.

## Core Principle

> Premature optimization is the root of all evil.
> But optimization is essential.
> Profile first.
> Optimize second.
> Measure after every change.
> Because intuition is wrong about performance.

## Performance Analysis

### Profiling
- CPU profiling: where is time spent?
- Memory profiling: where is memory allocated?
- I/O profiling: where is time waiting?
- Network profiling: where is bandwidth used?

### Metrics

| Metric | Description |
|--------|-------------|
| **Latency** | Time per operation |
| **Throughput** | Operations per second |
| **CPU usage** | Percentage of CPU used |
| **Memory usage** | Bytes allocated |
| **I/O wait** | Time waiting for I/O |
| **GC pause** | Garbage collection time |

### Bottleneck Identification
- Amdahl's Law: optimize the limiting factor
- Profile before optimizing
- Focus on hot paths
- Don't optimize what doesn't matter

## Optimization Strategies

### Algorithm Optimization
- Choose better algorithm
- Reduce time complexity
- Reduce space complexity
- Use appropriate data structures

### Data Structure Optimization
- Cache-friendly structures
- Memory layout
- Compression
- Lazy loading

### Caching
- In-memory caching
- Distributed caching
- CDN caching
- Browser caching
- Cache invalidation strategies

### Concurrency
- Parallel processing
- Async operations
- Thread pools
- Actor model
- Reactive programming

### Memory Optimization
- Object pooling
- Memory-mapped files
- Stack allocation
- Arena allocation
- Reduce allocations

### I/O Optimization
- Batching
- Buffering
- Compression
- Connection pooling
- Lazy I/O

## Optimization Process

```
1. Set performance goals
2. Profile current performance
3. Identify bottleneck
4. Optimize bottleneck
5. Measure improvement
6. Repeat until goals met
```

## Common Performance Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Premature optimization** | Optimizing too early | Profile first |
| **Wrong metric** | Optimizing the wrong thing | Measure the right thing |
| **Ignoring constants** | Focusing on Big-O, ignoring overhead | Measure actual performance |
| **Cache thrashing** | Caches constantly missing | Optimize access patterns |
| **Memory leaks** | Unbounded memory growth | Monitor and fix |
| **Blocking I/O** | Waiting for I/O | Use async I/O |

## Integration

- **Architecture**: Performance is architectural
- **Profiling**: Profiling guides optimization
- **Caching**: Caching improves performance
- **Concurrency**: Concurrency improves throughput
- **Database**: Database performance is critical
- **DevOps**: Monitoring detects performance issues

## Mantra

> Premature optimization is the root of all evil.
> But optimization is essential.
> Profile first.
> Optimize second.
> Measure after every change.
> Because intuition is wrong about performance.
> The only way to know is to measure.
