# Programming — Algorithmic Thinking

## Purpose

The art of solving problems with clear, step-by-step procedures. Not just knowing algorithms — thinking algorithmically. Decomposing problems, analyzing complexity, and choosing the right approach.

## Core Principle

> An algorithm is a finite sequence of well-defined instructions.
> Good algorithms are correct, efficient, and elegant.
> The best algorithm is the one that solves the problem simply.

## Algorithm Design Paradigms

### 1. Brute Force
Try all possible solutions.
- Simple to implement
- Often slow
- Good for small inputs
- Baseline for comparison

### 2. Divide and Conquer
Split problem into subproblems, solve recursively.
- Merge sort
- Quick sort
- Binary search
- Fast Fourier transform

### 3. Greedy
Make locally optimal choices at each step.
- Activity selection
- Huffman coding
- Kruskal's/Prim's algorithms
- Dijkstra's algorithm

### 4. Dynamic Programming
Store solutions to overlapping subproblems.
- Fibonacci
- Knapsack problem
- Longest common subsequence
- Edit distance

### 5. Backtracking
Explore all possibilities, prune invalid branches.
- N-queens
- Sudoku solver
- Graph coloring
- Subset sum

### 6. Randomized
Use randomness to improve average performance.
- Quickselect
- Random pivot quicksort
- Monte Carlo methods
- Las Vegas algorithms

## Complexity Analysis

### Time Complexity
| Notation | Meaning |
|----------|---------|
| O(1) | Constant |
| O(log n) | Logarithmic |
| O(n) | Linear |
| O(n log n) | Linearithmic |
| O(n²) | Quadratic |
| O(n³) | Cubic |
| O(2ⁿ) | Exponential |
| O(n!) | Factorial |

### Space Complexity
- How much memory does the algorithm use?
- In-place vs. out-of-place
- Stack space for recursion
- Auxiliary data structures

### Amortized Analysis
- Average performance over sequence of operations
- Dynamic arrays: occasional O(n) resize, average O(1) insert
- Union-Find: nearly O(1) per operation

## Data Structure Selection

| Problem | Best Data Structure |
|---------|-------------------|
| Fast lookup | Hash map |
| Sorted data | Balanced BST |
| Priority queue | Binary heap |
| LIFO operations | Stack |
| FIFO operations | Queue |
| Graph traversal | Adjacency list |
| Range queries | Segment tree |
| String matching | Trie, suffix array |

## Algorithmic Problem Solving

### Step 1: Understand the Problem
- What are the inputs?
- What are the outputs?
- What are the constraints?
- What are the edge cases?

### Step 2: Design the Algorithm
- What paradigm applies?
- What data structure is best?
- What is the time/space complexity?
- Can it be simplified?

### Step 3: Implement Correctly
- Start with clear, correct code
- Handle edge cases
- Test thoroughly
- Optimize if needed

### Step 4: Analyze and Optimize
- Is the complexity acceptable?
- Can it be improved?
- Are there better data structures?
- Is the constant factor acceptable?

## Common Algorithm Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Off-by-one** | Loop bounds wrong | Test boundaries |
| **Infinite loop** | Loop never terminates | Ensure progress |
| **Stack overflow** | Deep recursion | Use iteration or tail recursion |
| **Integer overflow** | Numbers too large | Use big integers |
| **Null pointer** | Dereferencing null | Check before use |
| **Race condition** | Concurrent access | Synchronize properly |

## Integration

- **Data Structures**: Algorithms operate on data structures
- **Optimization**: Algorithms are the tools of optimization
- **Systems Thinking**: Algorithmic thinking is systems thinking for code
- **Performance**: Algorithm choice determines performance
- **Complexity Science**: Algorithmic complexity is a form of complexity
- **Mathematical Thinking**: Algorithms are mathematical objects

## Mantra

> Choose the right algorithm.
> Choose the right data structure.
> Analyze before you optimize.
> Correct first, fast second.
> Simple is better than complex.
> But complex is better than incorrect.
