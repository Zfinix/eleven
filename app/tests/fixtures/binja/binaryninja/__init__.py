"""A stand-in for Binary Ninja's module with the same shapes, so Eleven's helper can be tested without a license."""

from enum import Enum


class SymbolType(Enum):
    FunctionSymbol = 0
    ImportedFunctionSymbol = 1
    ImportAddressSymbol = 2
    ExternalSymbol = 3


class Type:
    @staticmethod
    def int(width, sign):
        return ("int", width, sign)

    @staticmethod
    def char():
        return ("char",)

    @staticmethod
    def array(of, count):
        return ("array", of, count)


class Token:
    def __init__(self, text):
        self.text = text


class Line:
    def __init__(self, address, text):
        self.address = address
        self.tokens = [Token(text)]


class Block:
    def __init__(self, start, lines):
        self.start = start
        self._lines = lines

    def get_disassembly_text(self):
        return [Line(self.start + 4 * i, text) for i, text in enumerate(self._lines)]


class Symbol:
    def __init__(self, kind):
        self.type = kind


class Root:
    def __init__(self, lines):
        self.lines = [Line(0, text) for text in lines]


class Hlil:
    def __init__(self, lines):
        self.root = Root(lines)


class Function:
    def __init__(self, start, name, kind=SymbolType.FunctionSymbol):
        self.start = start
        self.name = name
        self.symbol = Symbol(kind)
        self.basic_blocks = [Block(start, ["push rbp", "mov rbp, rsp", "call helper", "ret"])]
        self.hlil = Hlil([f"int64_t {name}()", "{", "    return helper();", "}"])
        self.callees = []


class String:
    def __init__(self, start, value):
        self.start = start
        self.value = value


class Section:
    def __init__(self, start, length):
        self.start = start
        self.length = length


class Ref:
    def __init__(self, address, function):
        self.address = address
        self.function = function


class View:
    def __init__(self):
        main = Function(0x1000, "main")
        helper = Function(0x2000, "helper")
        main.callees = [helper]
        self.functions = [helper, main, Function(0x3000, "printf", SymbolType.ImportedFunctionSymbol)]
        self.strings = [String(0x4000, "hello"), String(0x4010, "world")]
        self.sections = {".text": Section(0x1000, 0x3000), ".data": Section(0x4000, 0x100)}
        self.defined = {}

    def get_function_at(self, addr):
        return next((fn for fn in self.functions if fn.start == addr), None)

    def get_functions_at(self, addr):
        return [fn for fn in self.functions if fn.start == addr]

    def get_code_refs(self, addr):
        target = self.get_function_at(addr)
        return [Ref(0x1008, fn) for fn in self.functions if target in fn.callees]

    def read(self, addr, length):
        return bytes((addr + i) % 256 for i in range(length))

    def undefine_user_data_var(self, addr):
        self.defined.pop(addr, None)

    def define_user_data_var(self, addr, kind):
        self.defined[addr] = kind

    def create_user_function(self, addr):
        self.functions.append(Function(addr, f"sub_{addr:x}"))

    def remove_user_function(self, fn):
        self.functions.remove(fn)

    def get_ascii_string_at(self, addr, min_length):
        return None

    def update_analysis_and_wait(self):
        return None


def load(path):
    return View()


def core_version():
    return "fake"
