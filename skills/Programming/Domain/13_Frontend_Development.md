# Programming — Frontend Development

## Purpose

The art of building user interfaces. Frontend is not just HTML/CSS/JS — it is the bridge between humans and machines. The frontend is what users see and touch. It must be fast, accessible, and beautiful.

## Core Principle

> The frontend is the product.
> Everything else is infrastructure.
> Users don't care about your architecture.
> They care about whether it works and feels good.

## Core Technologies

### HTML
- Semantic structure
- Accessibility (ARIA)
- SEO optimization
- Content hierarchy

### CSS
- Layout (Flexbox, Grid)
- Responsive design
- Animations
- Custom properties
- Modern features (container queries, cascade layers)

### JavaScript
- ES6+ features
- Async/await
- Modules
- DOM manipulation
- Event handling

## Frontend Architecture

### Component-Based Design
- Small, reusable components
- Single responsibility
- Composable
- Testable

### State Management
| Approach | Use Case |
|----------|----------|
| **Local state** | Component-specific |
| **Context** | Shared state |
| **Redux/Zustand** | Complex global state |
| **Server state** | API data (React Query, SWR) |
| **URL state** | Navigation state |

### Rendering Strategies
| Strategy | Description |
|----------|-------------|
| **CSR** | Client-side rendering |
| **SSR** | Server-side rendering |
| **SSG** | Static site generation |
| **ISR** | Incremental static regeneration |
| **Streaming SSR** | Progressive rendering |

## Performance

### Core Web Vitals
- **LCP**: Largest Contentful Paint
- **FID**: First Input Delay
- **CLS**: Cumulative Layout Shift
- **INP**: Interaction to Next Paint

### Optimization Techniques
- Code splitting
- Lazy loading
- Image optimization
- Font optimization
- Bundle analysis
- Tree shaking
- Compression

## Accessibility

### Principles (POUR)
- **Perceivable**: Content can be perceived
- **Operable**: Interface can be operated
- **Understandable**: Content is understandable
- **Robust**: Content works with assistive technology

### Key Practices
- Semantic HTML
- ARIA labels
- Keyboard navigation
- Color contrast
- Focus management
- Screen reader testing

## Common Frontend Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Layout shift** | Elements move unexpectedly | Set dimensions |
| **Bundle bloat** | Too much JavaScript | Code split, lazy load |
| **Accessibility** | Not usable by disabled users | Follow WCAG |
| **No responsive** | Not mobile-friendly | Mobile-first design |
| **Memory leaks** | Unbounded memory growth | Clean up effects |
| **Flash of unstyled content** | FOUC | Critical CSS |

## Integration

- **Backend**: Frontend consumes backend APIs
- **Design**: Frontend implements designs
- **Performance**: Frontend performance is critical
- **Accessibility**: Frontend must be accessible
- **Testing**: Frontend must be tested
- **DevOps**: Frontend deployment is automated

## Mantra

> The frontend is the product.
> Users see what you build.
> Make it fast.
> Make it accessible.
> Make it beautiful.
> Make it responsive.
> Because the frontend is where
> code meets human.
