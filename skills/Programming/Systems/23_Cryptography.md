# Programming — Cryptography

## Purpose

The science of secure communication. Cryptography is not just encryption — it is the foundation of digital security. Authentication, integrity, confidentiality, and non-repudiation all depend on cryptography.

## Core Principle

> Cryptography is not magic.
> It is math.
> Strong math.
> But it can be misused.
> Bad cryptography is worse than no cryptography.
> Because it gives false confidence.

## Cryptographic Primitives

### Symmetric Encryption
- Same key for encryption and decryption
- Fast
- Examples: AES, ChaCha20
- Use cases: Data encryption, disk encryption

### Asymmetric Encryption
- Different keys for encryption and decryption
- Slow
- Examples: RSA, ECC
- Use cases: Key exchange, digital signatures

### Hash Functions
- One-way transformation
- Fixed-size output
- Examples: SHA-256, BLAKE3
- Use cases: Integrity, password storage

### Digital Signatures
- Prove authenticity and integrity
- Non-repudiation
- Examples: RSA-SHA256, ECDSA
- Use cases: Code signing, certificates

### Key Exchange
- Establish shared secret over insecure channel
- Examples: Diffie-Hellman, ECDH
- Use cases: TLS, encrypted communication

## Cryptographic Protocols

### TLS/SSL
- Encrypts communication
- Authenticates server
- Integrity protection
- Used for: HTTPS, secure connections

### SSH
- Secure remote access
- Key-based authentication
- Port forwarding
- Used for: Server administration

### PGP/GPG
- Email encryption
- File encryption
- Web of trust
- Used for: Secure communication

### Signal Protocol
- End-to-end encryption
- Forward secrecy
- Used for: WhatsApp, Signal

## Common Cryptographic Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Roll your own crypto** | Custom algorithms | Use established libraries |
| **Weak algorithms** | Deprecated crypto | Use modern algorithms |
| **Hardcoded keys** | Keys in source code | Use key management |
| **No randomness** | Predictable keys | Use CSPRNG |
| **Side-channel attacks** | Timing, power analysis | Constant-time operations |
| **Quantum threats** | Shor's algorithm | Post-quantum crypto |

## Cryptographic Best Practices

1. **Use established libraries**: Don't implement your own
2. **Use modern algorithms**: AES-256, SHA-256, ECC
3. **Use proper key management**: Generate, store, rotate keys
4. **Use authenticated encryption**: AES-GCM, ChaCha20-Poly1305
5. **Use proper randomness**: CSPRNG for all crypto operations
6. **Plan for quantum**: Consider post-quantum algorithms

## Integration

- **Security**: Cryptography is fundamental to security
- **Networking**: TLS protects network communication
- **Authentication**: Cryptography enables authentication
- **Integrity**: Cryptography ensures data integrity
- **Privacy**: Cryptography protects privacy
- **Compliance**: Cryptography is often required

## Mantra

> Cryptography is not magic.
> It is math.
> Strong math.
> But it can be misused.
> Bad cryptography is worse than no cryptography.
> Use established libraries.
> Use modern algorithms.
> Use proper key management.
> Because the cost of getting crypto wrong
> is higher than the cost of getting it right.
