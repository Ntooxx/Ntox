# Programming — Cloud Architecture

## Purpose

The art of building systems on cloud infrastructure. Cloud is not just servers — it is a paradigm shift. From owning to renting, from static to dynamic, from manual to automated.

## Core Principle

> Cloud is not about servers.
> It is about moving faster.
> It is about scaling elastically.
> It is about paying for what you use.
> It is about focusing on your product, not your infrastructure.

## Cloud Service Models

| Model | Description | You Manage |
|-------|-------------|------------|
| **IaaS** | Virtual machines | OS, runtime, data |
| **PaaS** | Managed platforms | Just your code |
| **SaaS** | Software as service | Just your data |
| **FaaS** | Function as service | Just your function |

## Cloud Providers

| Provider | Strengths |
|----------|-----------|
| **AWS** | Most services, largest market share |
| **Azure** | Enterprise integration, .NET |
| **GCP** | Data/ML, Kubernetes |
| **Cloudflare** | Edge, CDN, Workers |
| **Vercel** | Frontend, serverless |

## Cloud Services

### Compute
| Service | Use Case |
|---------|----------|
| **EC2/VMs** | General compute |
| **Lambda/Functions** | Event-driven |
| **ECS/EKS/K8s** | Containers |
| **Fargate/Cloud Run** | Serverless containers |

### Storage
| Service | Use Case |
|---------|----------|
| **S3/Blob/GCS** | Object storage |
| **EBS/Persistent Disk** | Block storage |
| **EFS/Filestore** | File storage |
| **DynamoDB/CosmosDB** | NoSQL |
| **RDS/Cloud SQL** | Relational DB |

### Networking
| Service | Use Case |
|---------|----------|
| **VPC** | Network isolation |
| **Load Balancer** | Traffic distribution |
| **CDN** | Content delivery |
| **DNS** | Domain resolution |
| **API Gateway** | API management |

### Messaging
| Service | Use Case |
|---------|----------|
| **SQS/SQS** | Message queues |
| **SNS/EventGrid** | Pub/sub |
| **Kinesis/EventHubs** | Streaming |

## Cloud Design Patterns

| Pattern | Description |
|---------|-------------|
| **Auto-scaling** | Scale with demand |
| **Multi-AZ** | High availability |
| **Multi-region** | Disaster recovery |
| **Serverless** | No server management |
| **Edge computing** | Process close to users |
| **Blue-green** | Zero-downtime deployment |

## Cloud Cost Optimization

- Right-size instances
- Use spot/reserved instances
- Auto-scale to zero
- Monitor unused resources
- Use serverless where appropriate
- Compress and optimize data

## Common Cloud Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **Vendor lock-in** | Can't switch providers | Use abstractions |
| **Cost overrun** | Unexpected bills | Set budgets, alerts |
| **Security misconfiguration** | Exposed resources | Audit configurations |
| **No disaster recovery** | Data loss | Backup and DR plan |
| **Over-provisioning** | Paying for unused capacity | Auto-scaling |
| **Ignoring egress costs** | Data transfer costs | Minimize transfer |

## Integration

- **DevOps**: Cloud enables DevOps
- **Security**: Cloud security is critical
- **Performance**: Cloud affects performance
- **Scalability**: Cloud enables scalability
- **Cost**: Cloud costs money
- **Architecture**: Cloud changes architecture

## Mantra

> Cloud is not about servers.
> It is about moving faster.
> It is about scaling elastically.
> It is about paying for what you use.
> It is about focusing on your product, not your infrastructure.
> But remember:
> cloud is not free.
> Cloud is not always faster.
> Cloud is not always simpler.
> Know when to use it.
> Know when not to.
