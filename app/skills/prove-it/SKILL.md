---
name: prove-it
description: Turn a suspected bug into proof. Set a breakpoint where it would happen, run the program, and show the bad value or the crash in the debugger.
---

# Prove it in the debugger

A bug you can only describe is a hunch. A bug you can stop on is a finding. Use the debugger before you call anything a bug.

1. Say exactly what you suspect and where: the function, the instruction address, and what would go wrong there (an out-of-bounds index, a null pointer, a length that isn't checked, a value that overflows).
2. Work out what input reaches that code. Read the callers with `procedure_callers` and the pseudocode on the way in. Note the arguments or file contents the program needs.
3. `set_breakpoint` (eleven) on the instruction just before the bad operation, with a `condition` when it only goes wrong for some inputs (like `$x2 > 0x100`), then `debug_start`. If the program needs arguments or input you can't give it, say so and stop here with the plan.
4. When it stops, read the facts with `debug_state`, `debug_evaluate` and `debug_memory`: the registers and the buffers that matter. Step with `debug_control` until the bad thing happens or provably doesn't.
5. Record what you saw. `add_comment` on the instruction with the values, and `add_note` on the function, both with `evidence` that includes what the debugger showed, like `0x100003f2c x8 = 0x41414141 at the store`.

Report one of three results, plainly:
- Proven: the input, where it stopped, and the values that show the bug.
- Not a bug: what the debugger showed instead.
- Can't tell yet: what's missing (input, an entitlement, a device) and the next step.

Never report a bug as proven without debugger output from this session.
