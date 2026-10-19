---
name: name-functions
description: Make a stripped binary readable. Rename the functions worth naming, from FUN_ to plain names with a one-line note each, so the function list tells a story.
---

# Name the functions worth naming

A fresh binary is a wall of `FUN_` names. Do not rename all of them; that wastes effort on boilerplate. Spend it where it pays.

1. Use `list_procedures` and `current_view` (eleven) to see the function list and the total.
2. Pick the ones worth naming first:
   - the entry point and any exported symbols,
   - functions that reference a telling string (find them with `list_strings` / `search_strings` and the string's xrefs),
   - functions that call a notable import (crypto, network, file, process, auth).
3. For each: read it (`procedure_pseudo_code`, or `procedure_assembly`), understand it, `rename_function` (eleven) to a plain C name, and `add_note` one sentence.
4. Walk the call graph outward from what you named, a few levels deep, while it stays informative. Stop when you are into boilerplate (allocators, string helpers, CRT glue).

Report: how many you named, the handful that matter most and what each does, and where the interesting behavior lives. The renames and notes persist in the project, so the list stays readable next time.
