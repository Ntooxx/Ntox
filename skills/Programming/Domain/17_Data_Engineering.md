# Programming — Data Engineering

## Purpose

The practice of building data pipelines and infrastructure. Data engineering is not just ETL — it is the foundation of data-driven decisions. Without good data engineering, data science is impossible.

## Core Principle

> Data is the new oil.
> But oil is useless if it can't be refined.
> Data engineering is the refinery.
> Without it, data is just noise.

## Data Pipeline Architecture

```
Source → Ingestion → Processing → Storage → Serving → Consumption
  ↑                                                        ↓
  └────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| **Source** | Where data comes from |
| **Ingestion** | How data is collected |
| **Processing** | How data is transformed |
| **Storage** | Where data is stored |
| **Serving** | How data is accessed |
| **Consumption** | How data is used |

## Data Processing Paradigms

### Batch Processing
- Process large datasets
- Scheduled execution
- High throughput
- High latency
- Tools: Spark, Hadoop, Airflow

### Stream Processing
- Process data in real-time
- Continuous execution
- Low throughput per event
- Low latency
- Tools: Kafka, Flink, Spark Streaming

### Micro-batch
- Hybrid approach
- Small batches
- Near real-time
- Good balance
- Tools: Spark Structured Streaming

## Data Storage

### Data Warehouses
- Structured data
- SQL interface
- Optimized for analytics
- Schema-on-write
- Examples: Snowflake, BigQuery, Redshift

### Data Lakes
- Raw data
- All formats
- Schema-on-read
- Cheap storage
- Examples: S3, ADLS, GCS

### Data Lakehouses
- Best of both worlds
- ACID on data lakes
- Schema evolution
- Examples: Delta Lake, Iceberg, Hudi

### Operational Databases
- Transaction processing
- Low latency
- High concurrency
- Examples: PostgreSQL, MySQL, MongoDB

## Data Modeling

### Dimensional Modeling
- **Fact tables**: Measurements
- **Dimension tables**: Context
- **Star schema**: Simple
- **Snowflake schema**: Normalized

### Data Vault
- **Hubs**: Business keys
- **Links**: Relationships
- **Satellites**: Attributes
- Audit trail
- Scalable

### One Big Table
- Denormalized
- Simple queries
- Hard to maintain
- Good for exploration

## Data Quality

| Dimension | Description |
|-----------|-------------|
| **Accuracy** | Data is correct |
| **Completeness** | Data is not missing |
| **Consistency** | Data is the same across systems |
| **Timeliness** | Data is current |
| **Validity** | Data meets constraints |
| **Uniqueness** | No duplicates |

## Common Data Engineering Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **No data quality** | Bad data in pipeline | Validate data |
| **No monitoring** | Pipeline failures unnoticed | Monitor everything |
| **No versioning** | Can't reproduce results | Version data and code |
| **No documentation** | Nobody knows what data means | Document everything |
| **Over-engineering** | Complex pipeline for simple problem | Start simple |
| **No testing** | Pipeline breaks silently | Test pipelines |

## Integration

- **Database**: Data engineering builds on databases
- **Cloud**: Data engineering uses cloud services
- **DevOps**: Data engineering uses DevOps practices
- **Security**: Data security is critical
- **ML**: ML depends on data engineering
- **Analytics**: Analytics depends on data engineering

## Mantra

> Data is the new oil.
> But oil is useless if it can't be refined.
> Data engineering is the refinery.
> Build pipelines that are:
> Reliable
> Scalable
> Maintainable
> Testable
> Documented
> Because without good data engineering,
> data science is impossible.
