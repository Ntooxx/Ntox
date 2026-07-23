# Programming — Networking

## Purpose

The art of connecting systems. Networking is not just HTTP — it is the foundation of distributed systems. Understanding networking is understanding how systems communicate.

## Core Principle

> The network is unreliable.
> The network is slow.
> The network is insecure.
> Design for these realities.
> Because they are always true.

## Network Stack

### Layers (OSI Model)
| Layer | Purpose |
|-------|---------|
| **Physical** | Bits on wire |
| **Data Link** | Frame delivery |
| **Network** | Routing |
| **Transport** | End-to-end delivery |
| **Session** | Connection management |
| **Presentation** | Data formatting |
| **Application** | User protocols |

### Layers (TCP/IP Model)
| Layer | Purpose |
|-------|---------|
| **Link** | Physical network |
| **Internet** | IP routing |
| **Transport** | TCP/UDP |
| **Application** | HTTP, DNS, SMTP |

## Protocols

### TCP
- Reliable delivery
- Ordered
- Congestion control
- Connection-oriented
- Used for: HTTP, FTP, SMTP

### UDP
- Unreliable delivery
- Unordered
- No congestion control
- Connectionless
- Used for: DNS, video, gaming

### HTTP
- Request-response
- Stateless
- Headers and body
- Methods: GET, POST, PUT, DELETE
- Status codes

### DNS
- Domain name resolution
- Hierarchical
- Caching
- Record types (A, AAAA, CNAME, MX)

### TLS/SSL
- Encryption
- Authentication
- Integrity
- Handshake process

## Network Programming

### Sockets
- Low-level API
- TCP and UDP
- Client-server model
- Non-blocking I/O

### HTTP Libraries
- Request/response handling
- Connection pooling
- Cookie management
- Authentication

### WebSocket
- Full-duplex
- Real-time communication
- Persistent connection
- Used for: chat, gaming, updates

## Common Network Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Timeout** | Request takes too long | Set timeouts |
| **Connection refused** | Server not listening | Check server status |
| **DNS failure** | Can't resolve domain | Check DNS config |
| **Packet loss** | Data lost in transit | Retransmission |
| **Latency** | Slow response | Caching, CDN |
| **Security** | Data intercepted | Use TLS |

## Integration

- **OS**: OS provides networking
- **Security**: Network security is critical
- **Performance**: Network affects performance
- **Distributed Systems**: Networking enables distribution
- **Cloud**: Cloud uses networking
- **DevOps**: DevOps manages networks

## Mantra

> The network is unreliable.
> The network is slow.
> The network is insecure.
> Design for these realities.
> Because they are always true.
> And when you forget,
> the network will remind you.
