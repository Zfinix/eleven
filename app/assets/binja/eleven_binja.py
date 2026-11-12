"""Eleven's link to Binary Ninja's headless API: one JSON request per line on stdin, one reply per line on stdout."""

import json
import sys

try:
    import binaryninja
    from binaryninja import SymbolType, Type
except ImportError as missing:
    sys.stdout.write(json.dumps({"error": f"Python couldn't load Binary Ninja's module ({missing}). Check that Binary Ninja is installed and its Python is set up."}) + "\n")
    sys.exit(1)

IMPORTED = {SymbolType.ImportedFunctionSymbol, SymbolType.ImportAddressSymbol, SymbolType.ExternalSymbol}
DATA_SIZE = {"byte": 1, "word": 2, "dword": 4, "qword": 8}


def text_of(line):
    return "".join(token.text for token in line.tokens)


def function_at(bv, addr):
    found = bv.get_function_at(addr)
    if found is None:
        raise ValueError(f"no function starts at {addr:#x}")
    return found


def functions(bv):
    return [
        {"addr": hex(fn.start), "name": fn.name, "kind": "thunk" if fn.symbol.type in IMPORTED else "function"}
        for fn in sorted(bv.functions, key=lambda fn: fn.start)
    ]


def strings(bv):
    return [{"addr": hex(found.start), "text": found.value} for found in bv.strings]


def sections(bv):
    return [{"name": name, "start": hex(section.start), "length": section.length} for name, section in bv.sections.items()]


def disassembly(bv, addr):
    fn = function_at(bv, addr)
    lines = []
    for block in sorted(fn.basic_blocks, key=lambda block: block.start):
        lines.extend(f"{line.address:#x}  {text_of(line)}" for line in block.get_disassembly_text())
    return "\n".join(lines)


def pseudocode(bv, addr):
    fn = function_at(bv, addr)
    hlil = fn.hlil
    if hlil is None:
        raise ValueError(f"Binary Ninja has no high level IL for {fn.name}")
    return "\n".join(text_of(line) for line in hlil.root.lines)


def refs(bv, addr):
    fn = function_at(bv, addr)
    callers = [{"from": hex(ref.function.start if ref.function else ref.address), "at": hex(ref.address)} for ref in bv.get_code_refs(addr)]
    return {"callers": callers, "callees": [hex(callee.start) for callee in fn.callees]}


def retype(bv, addr, next_type, previous):
    bv.undefine_user_data_var(addr)
    if previous == "procedure" and next_type != "procedure":
        for fn in bv.get_functions_at(addr):
            bv.remove_user_function(fn)
    if next_type == "procedure":
        bv.create_user_function(addr)
    elif next_type in DATA_SIZE:
        bv.define_user_data_var(addr, Type.int(DATA_SIZE[next_type], False))
    elif next_type == "cstring":
        found = bv.get_ascii_string_at(addr, 1)
        length = found.length + 1 if found else 1
        bv.define_user_data_var(addr, Type.array(Type.char(), length))
    elif next_type == "undefined":
        bv.define_user_data_var(addr, Type.int(1, False))
    bv.update_analysis_and_wait()
    return None


def answer(bv, request):
    op = request["op"]
    addr = int(request.get("addr", "0"), 16)
    if op == "functions":
        return functions(bv)
    if op == "strings":
        return strings(bv)
    if op == "sections":
        return sections(bv)
    if op == "disassembly":
        return disassembly(bv, addr)
    if op == "pseudocode":
        return pseudocode(bv, addr)
    if op == "bytes":
        return bv.read(addr, int(request["length"])).hex()
    if op == "refs":
        return refs(bv, addr)
    if op == "retype":
        return retype(bv, addr, request.get("type"), request.get("previous"))
    raise ValueError(f"unknown request {op}")


def reply(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    try:
        bv = binaryninja.load(sys.argv[1])
    except Exception as error:
        reply({"error": str(error)})
        return
    if bv is None:
        reply({"error": "Binary Ninja could not open this file."})
        return
    reply({"ready": binaryninja.core_version()})
    for line in sys.stdin:
        try:
            reply({"ok": answer(bv, json.loads(line))})
        except Exception as error:
            reply({"error": str(error)})


if __name__ == "__main__":
    main()
