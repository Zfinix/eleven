---
name: find-path
description: Show how one function reaches another, step by step, and what each step does on the way.
---

# Find the path between two functions

The user names a start (often `entry`, a UI handler or an exported function) and a goal (a crypto call, a network send, a file write, a function they are curious about).

1. Resolve both to addresses with `search_procedures` or `list_procedures`.
2. Call `trace_call_path` with the start, the goal and direction `forward`. If the goal isn't reached, try `backward` from the goal to see who calls it, and meet in the middle.
3. If the path breaks at an Objective-C message, a vtable or a function pointer, say so. Find the real target from the selector string, the class's method list, or the value stored in the pointer, and continue from there.
4. `open_function` each step as you explain it so the user follows along, and `rename_function` the `FUN_` steps you understand, with `evidence`.

Report the path as a chain, start → … → goal, one line per step on what it does, and point out the step where the interesting decision is made. The user can also open the same path from the palette with "Find a call path from here…".
