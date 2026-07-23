# Programming — Game Development

## Purpose

The art of building interactive experiences. Game development is not just programming — it is combining code, art, audio, and design into an experience that engages and entertains.

## Core Principle

> Games are experiences.
> Code is the skeleton.
> Art is the skin.
> Audio is the soul.
> Design is the heart.
> All must work together.

## Game Architecture

### Game Loop
```
Initialize
While running:
    Process input
    Update game state
    Render
    Handle timing
Cleanup
```

### Entity-Component-System (ECS)
- **Entity**: Just an ID
- **Component**: Data only
- **System**: Logic only
- **Benefits**: Cache-friendly, composable, scalable

### Object-Oriented Game Design
- Inheritance hierarchies
- Polymorphism
- Easier to understand
- Harder to scale

## Game Systems

| System | Purpose |
|--------|---------|
| **Physics** | Movement, collision, forces |
| **Rendering** | Drawing, shaders, effects |
| **Input** | Keyboard, mouse, controller |
| **Audio** | Sound effects, music |
| **AI** | NPC behavior, pathfinding |
| **Networking** | Multiplayer, sync |
| **UI** | Menus, HUD, feedback |
| **Animation** | Character, effects |
| **Particles** | Visual effects |
| **Scripting** | Game logic |

## Physics

### Collision Detection
- Bounding boxes (AABB)
- Circles
- GJK algorithm
- Spatial partitioning (quadtree, octree)

### Rigid Body Physics
- Euler integration
- Verlet integration
- Impulse-based resolution
- Constraint solving

## Game AI

### Pathfinding
- A* algorithm
- Navigation meshes
- Flow fields
- Hierarchical pathfinding

### Behavior
- Finite state machines
- Behavior trees
- Utility AI
- GOAP (Goal-Oriented Action Planning)

## Common Game Dev Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Frame drops** | Inconsistent frame rate | Profile, optimize |
| **Input lag** | Delayed response | Process input early |
| **Memory leaks** | Growing memory usage | Track allocations |
| **Physics glitches** | Unstable simulation | Fixed timestep |
| **Save corruption** | Lost progress | Atomic writes |
| **Soft locks** | Game becomes unplayable | Test thoroughly |

## Integration

- **Architecture**: Game architecture is specialized
- **Performance**: Games must run at 60fps
- **Mathematics**: Games are math-heavy
- **Physics**: Physics simulation is core
- **AI**: Game AI is specialized
- **Networking**: Multiplayer is complex

## Mantra

> Games are experiences.
> Code is the skeleton.
> Art is the skin.
> Audio is the soul.
> Design is the heart.
> All must work together.
> And the player must have fun.
> Because without fun,
> it's not a game.
