# NTOX — Verification Engine

## Purpose

The final gatekeeper. Confirms that conclusions are valid, evidence is sufficient, and reasoning is sound. Not a rubber stamp — a rigorous, systematic check that catches errors before they become beliefs.

## Core Principle

> Trust, but verify.
> And when you verify, try to destroy.
> If the conclusion survives, it is worthy of belief.

## Verification Framework

### Layer 1: Logical Verification
- Is the argument logically valid?
- Does the conclusion follow from the premises?
- Are there hidden assumptions?
- Are there logical fallacies?

### Layer 2: Empirical Verification
- Is the evidence sufficient?
- Is the evidence reliable?
- Is the evidence relevant?
- Is there contradictory evidence?

### Layer 3: Methodological Verification
- Were appropriate methods used?
- Were methods applied correctly?
- Are limitations acknowledged?
- Could alternative methods produce different results?

### Layer 4: Statistical Verification
- Are statistical tests appropriate?
- Are results statistically significant?
- Are effect sizes meaningful?
- Are confidence intervals reasonable?
- Is there evidence of p-hacking?

### Layer 5: Reproducibility Verification
- Could this result be reproduced?
- Are methods described in sufficient detail?
- Is code/data available?
- Are there hidden dependencies?

### Layer 6: Consistency Verification
- Does this result contradict established knowledge?
- If so, is the evidence strong enough to overturn it?
- Does this result agree with related findings?
- Is the result internally consistent?

### Layer 7: Practical Verification
- Does this result matter in practice?
- Is the effect size practically significant?
- Are there real-world constraints that invalidate it?
- Could this be implemented or applied?

## Verification Procedures

### Procedure 1: Argument Reconstruction
1. State the conclusion explicitly
2. List all premises
3. Show the logical chain
4. Identify any gaps
5. Check each link

### Procedure 2: Evidence Audit
For each piece of evidence:
- Source quality
- Methodology quality
- Sample adequacy
- Potential biases
- Replicability
- Conflicting evidence

### Procedure 3: Sensitivity Analysis
- How sensitive is the conclusion to assumptions?
- What if the key assumption is wrong?
- What if the sample is biased?
- What if the method is flawed?
- What is the robustness of the result?

### Procedure 4: Alternative Explanation Generation
For any conclusion, generate at least 3 alternative explanations:
- The null hypothesis explanation
- The confound explanation
- The bias explanation
- The coincidence explanation
- The measurement error explanation

### Procedure 5: Prediction Testing
- What does this conclusion predict?
- Are those predictions testable?
- Have they been tested?
- What were the results?

## Verification Levels

| Level | Description | Action |
|-------|-------------|--------|
| **Verified** | Survives all checks | Accept with confidence |
| **Provisional** | Survives most checks but concerns remain | Accept with caveats |
| **Uncertain** | Mixed results across checks | Flag for further investigation |
| **Questionable** | Fails some checks | Reject or revise |
| **Refuted** | Fails critical checks | Reject |

## Common Verification Failures

| Failure | Description | Prevention |
|---------|-------------|------------|
| **Circular reasoning** | Using conclusion as premise | Check logical independence |
| **Cherry-picking** | Only reporting supporting evidence | Report all results |
| **HARKing** | Hypothesizing after results are known | Pre-register hypotheses |
| **P-hacking** | Trying many analyses until one works | Correct for multiple comparisons |
| **Overfitting** | Model matches noise, not signal | Cross-validate |
| **Underfitting** | Model too simple | Increase complexity |
| **Confirmation bias** | Seeking supporting evidence | Seek disconfirming evidence |
| **Survivorship bias** | Studying only successes | Account for failures |

## Verification Checklist

- [ ] Argument is logically valid
- [ ] Evidence is sufficient and reliable
- [ ] Methods are appropriate and correctly applied
- [ ] Statistical tests are appropriate
- [ ] Results are reproducible in principle
- [ ] Results are consistent with established knowledge (or evidence for overturning is strong)
- [ ] Practical significance is demonstrated
- [ ] Alternative explanations have been considered
- [ ] Limitations are acknowledged
- [ ] Conclusions are appropriately calibrated

## Integration With Other Modules

- **Scientific Method**: Verification is the final step of the scientific method
- **Critical Thinking**: Provides tools for evaluating arguments and evidence
- **Peer Review**: Verification is the core of peer review
- **Meta Cognition**: Monitors verification for its own biases
- **Failure Analysis**: Failed verifications are learning opportunities
- **Research Engine**: Verification confirms or refutes research findings

## The Verification Mantra

> I have reached a conclusion.
> Now I will try to destroy it.
> If it survives, I will believe it.
> If it doesn't, I will learn something.
> Either way, I am better off than before.
