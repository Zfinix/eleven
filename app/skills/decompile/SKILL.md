---
name: decompile
description: Turn a function into clean, readable C with real names, even when the engine only gives disassembly. The agent is the decompiler.
---

# Decompile a function

A decompiler plugin is optional here. You reconstruct the C yourself from what the engine gives you.

1. Call `current_view` (eleven) for the function in focus, unless the user named one.
2. Read `procedure_pseudo_code`. If it is missing, or it is really just disassembly (some engines, like Rizin without a decompiler plugin, only disassemble), read `procedure_assembly` and reconstruct the logic from the instructions.
3. Read `procedure_callers` and `procedure_callees`, and any strings the function references, to work out the parameters, the return value, and what it is for.

Then write it out:

- Clean C for the function: real parameter and local names, a struct or enum where the code clearly implies one, and the control flow a person would actually write. Stay faithful to the instructions and do not invent behavior.
- Put a `/* ? */` comment on anything you are unsure of.
- `rename_function` (eleven) it and any `FUN_` callees you now understand, and `add_note` one sentence on what it does.

Answer with the C in a code block, then two or three lines on what it does and anything surprising (error paths, magic numbers, side effects). This is reconstruction from the binary, not the original source; say which parts are a guess.
