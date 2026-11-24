---
name: solve-input
description: Find an input a program accepts (a serial, a key, a file header) when its check computes something instead of comparing to a stored value, by writing the check as a small solver.
---

# Solve for an input

Some checks hide the answer: a checksum, a hash, a sum of characters modulo a number. Reading them gives the rule, not the value. Write the rule down and let a script find a value.

1. Find the check with `find_code_for_string` on the success or failure message, then read it with `procedure_pseudo_code`.
2. Write down every condition the input must meet: its length, fixed characters, allowed ranges, and the arithmetic (sums, XORs, shifts, modulo). Keep the exact integer widths and signedness from the code.
3. Write a short script that encodes those conditions. Search the small part (a few unknown characters) directly, or use z3 when the arithmetic is tangled. Keep the search space small: fix every character the code fixes.
4. Check the answer against each condition from the code, by hand, before you report it. If running the program is allowed here, run it with the answer too.
5. `add_note` the rule on the checking function with `evidence` pointing at the instructions you read.

Report the rule in one or two sentences, the answer, and how you confirmed it. If several inputs work, say so and give one.
