# NTOX Cognitive Layer for DeepSeek Harness

This package mounts NTOX cognition into DeepSeek Harness without replacing the Harness runtime.

It translates three lifecycle surfaces:

- `agent/pre-step` calls `beforeStep` and appends the returned cognitive context
- `tools/result` calls `afterTool` with the final tool outcome
- `session/event` calls `afterTurn` when the turn closes

Add the plugin package to a Harness profile and configure it like any other Cordis plugin. Every subsystem can be disabled independently, and removing the plugin restores the baseline Harness behavior.

```yaml
- id: ntox-cognition
  name: '@ntox/deepseek-harness'
  config:
    cognitionEnabled: true
    memoryEnabled: true
    theoryEnabled: true
    mistakesEnabled: true
    strategyEnabled: true
```
