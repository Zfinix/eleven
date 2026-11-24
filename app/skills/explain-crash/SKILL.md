---
name: explain-crash
description: Find out why the app crashed from its crash report: the frame where it went wrong, the state that leads there, and how to make it happen again.
---

# Explain a crash

The user has a macOS crash report (.ips) from this app, usually in ~/Library/Logs/DiagnosticReports. Ask for its path if they didn't give it.

1. Call `read_crash_report` (eleven) with the path. Note the exception (for example EXC_BAD_ACCESS at 0x0 is a null pointer, EXC_BREAKPOINT is often a Swift trap such as a force unwrap or an out-of-range index) and the top frames that are in this binary.
2. `open_function` the top frame in this binary and read its pseudocode. Find the instruction the frame points at and what it touches there.
3. Walk down the stack with `procedure_callers` and the next frames, to see where the bad value came from: a missing check, a freed object, an index from input.
4. If it can be reproduced, use the prove-it skill: a `set_breakpoint` with a `condition` on the value that goes bad, then `debug_start`.
5. `add_note` on the crashing function with `evidence` (the frame address and what you saw), and add one paragraph to the notebook with `add_to_notebook`.

Report: the exception in plain words, the function and line where it happened, the chain of calls that leads there, the input or state that triggers it, and a one-line fix if the code makes it clear. Say plainly what you confirmed and what is still a guess.
