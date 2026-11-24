import { expect, test } from "bun:test";

import { cTypeName } from "../src/engine/cTypes";

test("a C declaration's type name, for structs, unions, enums and typedefs", () => {
  expect(cTypeName("struct header {\n  int magic; // first\n  short version;\n};")).toBe("header");
  expect(cTypeName("union value { int i; float f; }")).toBe("value");
  expect(cTypeName("enum mode { OFF, ON };")).toBe("mode");
  expect(cTypeName("typedef struct { int x, y; } point;")).toBe("point");
  expect(cTypeName("typedef unsigned char key_t[16];")).toBe("key_t");
  expect(cTypeName("typedef int (*handler)(void *ctx, int code);")).toBe("handler");
  expect(cTypeName("int x;")).toBeNull();
});
