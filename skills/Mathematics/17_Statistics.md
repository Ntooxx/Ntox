# NTOX — Statistics Engine

## Purpose

The science of learning from data. Not just running tests — understanding what data can tell us, what it cannot, and how to avoid fooling ourselves.

## Core Principle

> Statistics is the science of uncertainty.
> It quantifies what we don't know.
> It measures how much we can trust what we think we know.
> And it tells us when we're fooling ourselves.

## Statistical Framework

### Descriptive Statistics
**What does the data look like?**

| Measure | Purpose |
|---------|---------|
| **Mean** | Central tendency |
| **Median** | Robust central tendency |
| **Mode** | Most common value |
| **Variance** | Spread around the mean |
| **Standard deviation** | Spread in original units |
| **IQR** | Robust spread |
| **Skewness** | Asymmetry of distribution |
| **Kurtosis** | Tail heaviness |

### Inferential Statistics
**What does the data tell us about the population?**

| Method | Purpose |
|--------|---------|
| **Confidence intervals** | Range of plausible parameter values |
| **Hypothesis tests** | Evidence against null hypothesis |
| **Effect sizes** | Magnitude of difference |
| **Power analysis** | Probability of detecting true effect |
| **Bayesian inference** | Update beliefs with data |

### Exploratory Data Analysis
**What patterns exist in the data?**

| Tool | Purpose |
|------|---------|
| **Visualization** | See patterns and outliers |
| **Summary statistics** | Quick overview |
| **Correlation** | Linear relationships |
| **Clustering** | Group similar observations |
| **Dimensionality reduction** | Simplify high-dimensional data |

## Hypothesis Testing

### The Null Hypothesis Framework
1. State null hypothesis (H₀) and alternative (H₁)
2. Choose significance level (α)
3. Calculate test statistic
4. Calculate p-value
5. Compare p-value to α
6. Make decision

### Interpreting Results
- **p < α**: Reject H₀ (statistically significant)
- **p ≥ α**: Fail to reject H₀ (not statistically significant)
- **Never**: Accept H₀ (absence of evidence ≠ evidence of absence)

### Common Tests

| Test | Use Case |
|------|----------|
| **t-test** | Comparing means |
| **ANOVA** | Comparing multiple means |
| **χ² test** | Categorical data |
| **Fisher's exact** | Small categorical samples |
| **Mann-Whitney** | Non-parametric comparison |
| **Kruskal-Wallis** | Non-parametric multiple comparison |
| **Correlation** | Linear relationship |

## Bayesian Statistics

### Bayes' Theorem
```
P(H|D) = P(D|H) × P(H) / P(D)
```

### Bayesian Updating
- Start with prior beliefs
- Update with data
- Get posterior beliefs
- Repeat as more data arrives

### Advantages
- Incorporates prior knowledge
- Quantifies uncertainty directly
- Natural for sequential analysis
- No p-value misinterpretation

### Challenges
- Prior specification
- Computational complexity
- Subjectivity concerns
- Communication difficulties

## Effect Sizes

### Why Effect Sizes Matter
- Statistical significance ≠ practical significance
- Large samples can make trivial effects significant
- Effect sizes measure practical importance

### Common Effect Sizes

| Measure | Use |
|---------|-----|
| **Cohen's d** | Difference between means |
| **Pearson's r** | Correlation strength |
| **Odds ratio** | Association in 2×2 tables |
| **R²** | Variance explained |
| **η²** | Variance explained in ANOVA |

## Common Statistical Errors

| Error | Description | Prevention |
|-------|-------------|------------|
| **P-hacking** | Trying many tests until significant | Pre-register, correct for multiple comparisons |
| **HARKing** | Hypothesizing after results known | Pre-register hypotheses |
| **Overfitting** | Model fits noise | Cross-validation |
| **Confounding** | Hidden variables | Randomization |
| **Survivorship bias** | Studying only successes | Account for all cases |
| **Ecological fallacy** | Inference across levels | Use appropriate level |
| **Simpson's paradox** | Trends reverse in subgroups | Examine subgroups |

## Statistical Best Practices

1. **Pre-register** hypotheses when possible
2. **Report effect sizes**, not just p-values
3. **Provide confidence intervals** for estimates
4. **Correct for multiple comparisons**
5. **Use Bayesian methods** when appropriate
6. **Visualize data** before analyzing
7. **Check assumptions** of statistical tests
8. **Report all results**, not just significant ones
9. **Replicate findings** when possible
10. **Be transparent** about methods and decisions

## Integration With Other Modules

- **Scientific Method**: Statistics provides the tools for data analysis
- **Mathematical Thinking**: Statistics is a branch of mathematics
- **Research Engine**: Statistics guides research design and analysis
- **Experimental Design**: Statistics determines sample size and power
- **Verification**: Statistics verifies that results are reliable
- **Discovery Engine**: Statistical patterns can reveal discoveries

## The Statistics Mantra

> Data does not speak for itself.
> It whispers.
> Statistics is the art of listening.
> But listen carefully.
> Because data can lie.
> And statistics can be misused.
> The goal is truth, not significance.
> The goal is understanding, not numbers.
