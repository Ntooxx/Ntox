# NTOX — Network Science

## Purpose

The study of interconnected systems. From social networks to neural networks, from power grids to the internet, from food webs to metabolic pathways. Networks are the structure of complexity.

## Core Principle

> Everything is connected.
> The pattern of connections matters as much as the connections themselves.
> Network structure determines system behavior.
> Understanding networks means understanding the world.

## Core Concepts

### Network Elements
- **Nodes**: The entities (people, computers, neurons, species)
- **Edges**: The connections (friendships, wires, synapses, predator-prey)
- **Degree**: Number of connections per node
- **Path**: Sequence of connections between nodes
- **Component**: Connected part of the network

### Network Measures

| Measure | Description |
|---------|-------------|
| **Degree distribution** | How many connections nodes have |
| **Clustering coefficient** | How connected are neighbors |
| **Path length** | Average distance between nodes |
| **Diameter** | Maximum distance between nodes |
| **Centrality** | How important is a node |
| **Modularity** | How much the network has communities |
| **Assortativity** | Do similar nodes connect |

### Network Types

| Type | Properties | Examples |
|------|-----------|----------|
| **Random** | Erdős–Rényi, Poisson degree distribution | Random connections |
| **Small-world** | Short paths, high clustering | Social networks |
| **Scale-free** | Power-law degree distribution, hubs | Internet, citation networks |
| **Regular** | Lattice-like structure | Grids, crystals |
| **Hierarchical** | Nested communities | Biological networks |
| **Bipartite** | Two types of nodes, edges between types | Author-paper networks |

## Network Phenomena

### Epidemic Spreading
How diseases (or information) spread through networks.
- **SIR model**: Susceptible → Infected → Recovered
- **Threshold**: Epidemic spreads if R₀ > 1
- **Network structure** affects spread patterns
- **Hubs** are super-spreaders

### Robustness and Fragility
How networks respond to failure.
- **Random failure**: Scale-free networks are robust
- **Targeted attack**: Scale-free networks are fragile
- **Cascading failures**: One failure triggers others
- **Percolation**: Critical threshold for network fragmentation

### Synchronization
How coupled oscillators synchronize.
- Kuramoto model
- Chimera states
- Phase transitions
- Network structure affects synchronization

### Community Detection
Finding groups in networks.
- Modularity optimization
- Spectral methods
- Stochastic block models
- Overlapping communities

### Influence and Contagion
How influence spreads through networks.
- Threshold models
- Linear diffusion
- Complex contagion
- Word-of-mouth effects

## Network Applications

| Domain | Network |
|--------|---------|
| **Biology** | Neural, metabolic, protein interaction, food web |
| **Social** | Friendship, communication, collaboration, influence |
| **Technology** | Internet, power grid, transportation, communication |
| **Economic** | Trade, financial, supply chain |
| **Ecological** | Predator-prey, mutualistic, competitive |
| **Epidemiological** | Contact, travel, disease |

## Network Tools

- **Graph theory**: Mathematical foundation
- **Statistical mechanics**: Analyze large networks
- **Spectral analysis**: Eigenvalues reveal structure
- **Agent-based modeling**: Simulate network dynamics
- **Machine learning**: Learn network structure from data

## Common Network Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Ignoring structure** | Treating network as random | Analyze actual structure |
| **Aggregation bias** | Losing temporal information | Use dynamic networks |
| **Selection bias** | Sampling only visible nodes | Consider hidden nodes |
| **Confusion** | Correlation ≠ causation | Use experimental methods |
| **Scale confusion** | Patterns at one scale don't apply at another | Consider multiple scales |

## Integration With Other Modules

- **Complexity Science**: Networks are a core topic in complexity science
- **Systems Thinking**: Networks are a formalization of systems thinking
- **Information Theory**: Information flows through networks
- **Economics**: Economic networks determine market behavior
- **Biology**: Biological networks determine organism behavior
- **Social**: Social networks determine information spread

## The Network Science Mantra

> The connections are as important as the nodes.
> The structure determines the behavior.
> Small changes in structure can cause large changes in behavior.
> Hub nodes are both powerful and vulnerable.
> And the network is always more complex than you think.
