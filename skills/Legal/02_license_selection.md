# Open Source License Selection

## Triggers
- "which license should i use"
- "oss license"
- "license comparison"
- "gpl vs mit"
- "license compliance"
- "can i use this library"
- "apache or mit"

## Purpose
Chooses an open-source license for a project and checks compliance when using third-party code — matching obligations to intent instead of copying a badge from another repo.

## Scope

General information, not legal advice. Patent questions and dual-licensing business models need a real lawyer.

## Decision Matrix

| License | Use when | Key obligations | Patent grant |
|---------|----------|-----------------|--------------|
| **MIT** | Maximal adoption, code only | Keep the copyright notice | None explicit |
| **Apache-2.0** | Corporate/Java/Android ecosystems, patent-sensitive | Keep notices + state changes | Yes, explicit |
| **BSD-3** | Like MIT with a no-endorsement clause | Keep the notice | None explicit |
| **GPL-3.0** | Derivatives must stay free | Distributing users get full source, same license | Yes |
| **AGPL-3.0** | Network services must share modifications | SaaS counts as distribution | Yes |
| **MPL-2.0** | File-level copyleft, linking is fine | Modified files stay open | Yes |
| **Proprietary / source-available** | Revenue from licensing | Contract terms govern | Depends |

## Selection Questions

1. Is your goal adoption, control, or commercial licensing? Adoption → MIT/Apache. Control (prevent closed forks) → GPL/AGPL. Commercial dual-licensing → needs a CLA and a permissive base license.
2. Will it run as a service? AGPL is the copyleft that reaches SaaS; GPL does not.
3. Do contributors need patent peace? Apache-2.0 grants it; MIT does not.
4. Compatibility: GPL-3 code cannot be linked into an Apache-2.0 project; Apache-2.0 code inside GPL-3 is fine.

## Compliance Checklist (using dependencies)

- Every dependency's LICENSE file is present in the repo or distribution.
- Notices preserved exactly — copyright lines are not paraphrased.
- Copyleft obligations mapped: for each GPL dependency, confirm your distribution triggers (or does not trigger) source disclosure.
- No license? Treat as "all rights reserved" — do not use it.
- Record the check: dependency, version, license, date.

## Output Format

Give the recommendation first (license + one-line reason), then the table row that supports it, the obligations as a checklist, and the one scenario in which a different choice would be better.
