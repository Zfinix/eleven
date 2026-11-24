---
name: check-claims
description: Re-check the names, notes and comments in this project that have no evidence behind them, and back each one up, fix it, or take it back.
---

# Check the guesses

Agents name code from what it looks like, and a confident name can still be wrong. This pass goes over every mark that nobody backed up.

1. Call `list_marks` (eleven). Marks tagged `[a guess …, no evidence]` are your work list. Marks with `[based on …]` were checked already, so skip them unless one is plainly wrong.
2. For each guess, read the code it is about again (`procedure_pseudo_code`, `procedure_assembly`, its callers and callees, the strings it uses).
3. Then do one of three things:
   - It holds up: set it again with the same tool (`rename_function`, `add_note`, `add_comment`, `bookmark`) and pass `evidence` with the addresses that prove it.
   - It is wrong: set the right name or note, with evidence.
   - The code doesn't settle it: remove the note or comment (an empty one removes it) and say why in your report. Leave a rename only if it is still the best reading, and say it is unconfirmed.

Report three short lists: confirmed, corrected (old → new and why), and still unsure. Never mark something confirmed without an address you actually read.
