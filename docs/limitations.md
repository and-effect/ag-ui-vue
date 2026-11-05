# Limitations

- **Interrupts: structured lifecycle only.** `useInterrupts` handles AG-UI 1.0's `RUN_FINISHED.outcome` / `resume` lifecycle. It does not handle the legacy LangGraph `on_interrupt` custom event or `command.resume`. Agent capabilities (`humanInTheLoop.interrupts` / `approveWithEdits`) are not read either: affordances come from each interrupt's `responseSchema`.
- **One live conversation at a time.** Switching threads aborts the outgoing run; inactive threads don't keep background runs alive, and switching back re-attaches to the persisted transcript, not a still-streaming run.
