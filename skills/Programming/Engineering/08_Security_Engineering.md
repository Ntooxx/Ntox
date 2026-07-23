# Programming — Security Engineering

## Purpose

The practice of protecting systems from threats. Security is not a feature — it is a property of the entire system. Security is not optional — it is essential.

## Core Principle

> Security is not a feature.
> It is a property of the entire system.
> If you think security is expensive, try a breach.
> The cost of prevention is always less than the cost of recovery.

## Security Principles

### Defense in Depth
- Multiple layers of security
- No single point of failure
- Redundant protections
- Assume any layer can fail

### Least Privilege
- Minimum necessary permissions
- No unnecessary access
- Time-limited access
- Regular privilege review

### Secure by Default
- Default to secure settings
- Require explicit insecure configuration
- Fail securely
- Deny by default

### Separation of Duties
- No single person has all access
- Checks and balances
- Audit trails
- No conflict of interest

## Common Vulnerabilities

### OWASP Top 10
| Vulnerability | Description |
|---------------|-------------|
| **Injection** | SQL, NoSQL, OS command injection |
| **Broken Authentication** | Weak auth mechanisms |
| **Sensitive Data Exposure** | Unprotected sensitive data |
| **XML External Entity** | XXE attacks |
| **Broken Access Control** | Inadequate authorization |
| **Security Misconfiguration** | Default or weak configs |
| **Cross-Site Scripting** | XSS attacks |
| **Insecure Deserialization** | Unsafe object deserialization |
| **Using Components with Known Vulnerabilities** | Outdated dependencies |
| **Insufficient Logging** | Inadequate monitoring |

### Other Vulnerabilities

| Vulnerability | Description |
|---------------|-------------|
| **Buffer Overflow** | Writing past buffer bounds |
| **Race Conditions** | Timing-dependent bugs |
| **Privilege Escalation** | Gaining unauthorized access |
| **Social Engineering** | Manipulating people |
| **Phishing** | Deceptive communications |
| **Man-in-the-Middle** | Intercepting communications |

## Security Practices

### Authentication
- Multi-factor authentication
- Strong password policies
- Secure password storage (hashing, salting)
- Session management
- OAuth/OpenID Connect

### Authorization
- Role-based access control (RBAC)
- Attribute-based access control (ABAC)
- Policy-based access control
- Audit logging

### Cryptography
- Encryption at rest and in transit
- Proper key management
- Secure random number generation
- Hashing for integrity
- Digital signatures

### Secure Development
- Input validation
- Output encoding
- Parameterized queries
- Content Security Policy
- Regular dependency updates

## Common Security Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Roll your own crypto** | Custom encryption | Use established libraries |
| **Hardcoded secrets** | Keys in code | Use secret management |
| **No input validation** | Trusting user input | Validate everything |
| **Ignoring dependencies** | Known vulnerabilities | Regular updates |
| **No logging** | Can't detect breaches | Comprehensive logging |
| **Security by obscurity** | Hiding implementation | Defense in depth |

## Integration

- **Architecture**: Security is architectural
- **DevOps**: Security in CI/CD pipeline
- **Testing**: Security testing is essential
- **API Design**: API security is critical
- **Database**: Database security is essential
- **Networking**: Network security is foundational

## Mantra

> Security is not a feature.
> It is a property of the entire system.
> Assume breach.
> Defend in depth.
> Least privilege.
> Secure by default.
> Because the cost of prevention
> is always less than the cost of recovery.
