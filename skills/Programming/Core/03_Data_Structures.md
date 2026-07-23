# Programming — Data Structures

## Purpose

The building blocks of programs. Data structures are not just containers — they are the foundation of algorithm design. The right data structure makes the right algorithm possible.

## Core Principle

> Data structures determine what operations are possible.
> What operations are possible determines what algorithms are possible.
> What algorithms are possible determines what programs are possible.
> Choose your data structures wisely.

## Fundamental Data Structures

### Arrays
- Contiguous memory
- O(1) access by index
- O(n) insert/delete
- Cache-friendly
- Fixed or dynamic size

### Linked Lists
- Non-contiguous memory
- O(n) access by index
- O(1) insert/delete at head
- Not cache-friendly
- Dynamic size

### Stacks
- LIFO (Last In, First Out)
- O(1) push/pop
- O(n) search
- Used for: function calls, undo, parsing

### Queues
- FIFO (First In, First Out)
- O(1) enqueue/dequeue
- O(n) search
- Used for: BFS, scheduling, buffering

### Hash Maps
- Key-value storage
- O(1) average lookup/insert/delete
- O(n) worst case (collisions)
- No ordering
- Used for: caching, counting, deduplication

### Trees
- Hierarchical structure
- O(log n) operations (balanced)
- Many variants

#### Binary Search Tree
- Left < Root < Right
- O(log n) search/insert/delete (balanced)
- O(n) worst case (unbalanced)

#### AVL Tree
- Self-balancing BST
- O(log n) guaranteed
- Strict balance

#### Red-Black Tree
- Self-balancing BST
- O(log n) guaranteed
- Relaxed balance

#### B-Tree
- Self-balancing tree for disks
- O(log n) search/insert/delete
- Optimized for block storage

#### Trie
- Prefix tree for strings
- O(m) search (m = string length)
- Used for: autocomplete, dictionary

### Heaps
- Parent ≤ children (min-heap) or ≥ (max-heap)
- O(1) find-min/max
- O(log n) insert/delete
- Used for: priority queues, heapsort

### Graphs
- Vertices and edges
- Directed or undirected
- Weighted or unweighted
- Many representations

#### Adjacency Matrix
- O(1) edge lookup
- O(V²) space
- Good for dense graphs

#### Adjacency List
- O(degree) edge lookup
- O(V + E) space
- Good for sparse graphs

## Advanced Data Structures

| Structure | Purpose |
|-----------|---------|
| **Disjoint Set** | Union-find operations |
| **Segment Tree** | Range queries |
| **Fenwick Tree** | Prefix sums |
| **Bloom Filter** | Probabilistic membership |
| **Skip List** | Probabilistic balanced tree |
| **Splay Tree** | Self-adjusting BST |
| **Ternary Search Tree** | String sets |

## Data Structure Selection Guide

| Need | Data Structure |
|------|----------------|
| Fast lookup by key | Hash map |
| Sorted data | BST (AVL, Red-Black) |
| Priority operations | Heap |
| LIFO operations | Stack |
| FIFO operations | Queue |
| Union/Find | Disjoint Set |
| Range queries | Segment Tree |
| String prefix search | Trie |
| Probabilistic membership | Bloom Filter |
| Graph adjacency | Adjacency list/matrix |

## Common Data Structure Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Wrong structure** | Using array for frequent insert | Choose based on operations |
| **Not checking bounds** | Accessing invalid index | Validate indices |
| **Memory leaks** | Not freeing memory | Use RAII or garbage collection |
| **Circular references** | Memory can't be freed | Use weak references |
| **Ignoring cache** | Cache misses slow down | Use cache-friendly structures |

## Integration

- **Algorithms**: Data structures enable algorithms
- **Performance**: Data structure choice affects performance
- **Memory**: Data structures determine memory usage
- **Architecture**: Data structures are architectural decisions
- **Optimization**: Better data structures = better performance
- **Database**: Databases use specialized data structures

## Mantra

> Choose the right data structure.
> The algorithm follows.
> Operations define data structures.
> Data structures define possibilities.
> The best data structure is the one
> that makes the necessary operations efficient.
