import { describe, it, expect } from "vitest";
import { Attribution } from "ox/erc8021";
import {
  BUILDER_CODE,
  BUILDER_DATA_SUFFIX,
  builderCapabilities,
  appendBuilderSuffix,
} from "@/lib/onchain/builderCode";

// These guard a SILENT failure mode: a wrong/garbled suffix still sends the tx, we just earn no
// builder attribution. So we assert the on-chain bytes decode back to OUR exact registered code.
describe("Base builder-code attribution (ERC-8021)", () => {
  it("targets our registered builder code (bc_ prefix included)", () => {
    expect(BUILDER_CODE).toBe("bc_bu1cyzms");
  });

  it("encodes a suffix that decodes back to our exact code", () => {
    expect(BUILDER_DATA_SUFFIX).toMatch(/^0x[0-9a-f]+$/);
    expect(Attribution.fromData(BUILDER_DATA_SUFFIX)).toEqual({ codes: [BUILDER_CODE], id: 0 });
  });

  it("pins the exact suffix bytes (guards against an ox encoding change)", () => {
    expect(BUILDER_DATA_SUFFIX).toBe(
      "0x62635f62753163797a6d730b0080218021802180218021802180218021",
    );
  });

  it("exposes the ERC-5792 dataSuffix capability, optional so it never fails a tx", () => {
    expect(builderCapabilities()).toEqual({
      dataSuffix: { value: BUILDER_DATA_SUFFIX, optional: true },
    });
    expect(builderCapabilities({ paymasterService: { url: "x" } })).toMatchObject({
      paymasterService: { url: "x" },
      dataSuffix: { value: BUILDER_DATA_SUFFIX, optional: true },
    });
  });

  it("appends the suffix to raw calldata and still decodes to our code", () => {
    const calldata = "0xa9059cbb" + "00".repeat(8);
    const withSuffix = appendBuilderSuffix(calldata);
    expect(withSuffix.startsWith(calldata)).toBe(true);
    expect(withSuffix.endsWith(BUILDER_DATA_SUFFIX.slice(2))).toBe(true);
    expect(Attribution.fromData(withSuffix)).toEqual({ codes: [BUILDER_CODE], id: 0 });
    // bare value transfer (no calldata) is just the suffix
    expect(appendBuilderSuffix()).toBe(BUILDER_DATA_SUFFIX);
    expect(appendBuilderSuffix("0x")).toBe(BUILDER_DATA_SUFFIX);
  });
});
