import { expect, test } from "bun:test";

import { linkTo, parseLink } from "../src/lib/deepLink";

const SHA = "a".repeat(64);

test("a link round-trips its project, address and name", () => {
  const link = linkTo(SHA, "0x100000C78", "Photo Filter.app");
  expect(link).toBe(`eleven://open/${SHA}?at=0x100000C78&name=Photo+Filter.app`);
  expect(parseLink(link)).toEqual({ project: SHA, address: "0x100000c78", name: "Photo Filter.app" });
  expect(parseLink(linkTo(SHA, null))).toEqual({ project: SHA, address: null, name: null });
});

test("anything that isn't an Eleven link to a project is refused", () => {
  expect(parseLink("/Users/me/PhotoFilter.app")).toBeNull();
  expect(parseLink("https://open/" + SHA)).toBeNull();
  expect(parseLink("eleven://open/not-a-hash")).toBeNull();
  expect(parseLink(`eleven://delete/${SHA}`)).toBeNull();
  expect(parseLink(`eleven://open/${SHA}?at=rm -rf`)).toEqual({ project: SHA, address: null, name: null });
});
