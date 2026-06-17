import { describe, it, expect } from "vitest";
import { validateIntent, castCommand, type TxIntent, type TxArgValue } from "@/lib/admin/tx";

const ADDR = "0x" + "1".repeat(40);

function intent(args: TxArgValue[], over: Partial<TxIntent> = {}): TxIntent {
  return {
    contractKey: "feeRouter",
    contractName: "FeeRouter",
    address: null,
    signature: "f()",
    fn: "f",
    args,
    ...over,
  };
}
const arg = (type: string, value: string, extra: Partial<TxArgValue> = {}): TxArgValue => ({
  name: "x",
  type,
  value,
  ...extra,
});

describe("validateIntent", () => {
  it("accepts a well-formed address and rejects a malformed one", () => {
    expect(validateIntent(intent([arg("address", ADDR)]))).toEqual([]);
    expect(validateIntent(intent([arg("address", "0xnope")]))).toEqual(["x must be a 0x address"]);
  });

  it("requires a non-empty value for everything except a string", () => {
    expect(validateIntent(intent([arg("uint256", "  ")]))).toEqual(["x is required"]);
    expect(validateIntent(intent([arg("string", "")]))).toEqual([]); // setURI("") is legitimate
  });

  it("checks bool literals", () => {
    expect(validateIntent(intent([arg("bool", "true")]))).toEqual([]);
    expect(validateIntent(intent([arg("bool", "yes")]))).toEqual(["x must be true or false"]);
  });

  it("enforces width-aware uint bounds", () => {
    expect(validateIntent(intent([arg("uint8", "255")]))).toEqual([]);
    expect(validateIntent(intent([arg("uint8", "256")]))).toEqual(["x exceeds uint8 max"]);
    expect(validateIntent(intent([arg("uint256", "abc")]))).toEqual(["x must be a whole number"]);
  });

  it("validates bytes32", () => {
    expect(validateIntent(intent([arg("bytes32", "0x" + "b".repeat(64))]))).toEqual([]);
    expect(validateIntent(intent([arg("bytes32", "0xb")]))).toEqual(["x must be 32 bytes (0x + 64 hex)"]);
  });

  describe("FeeRouter Split tuple — the solvency-critical invariant", () => {
    const split = (value: string) =>
      intent([
        arg("(uint16,uint16,uint16,uint16)", value, {
          components: [
            { name: "pool", type: "uint16" },
            { name: "jackpot", type: "uint16" },
            { name: "burn", type: "uint16" },
            { name: "treasury", type: "uint16" },
          ],
        }),
      ]);

    it("accepts a split that sums to exactly 10000 bps", () => {
      expect(validateIntent(split("(4000,1000,2000,3000)"))).toEqual([]);
    });
    it("rejects a split that doesn't sum to 10000", () => {
      expect(validateIntent(split("(4000,1000,2000,2999)"))).toEqual(["x must sum to 10000 bps"]);
    });
    it("rejects a share over 10000 bps", () => {
      expect(validateIntent(split("(11000,0,0,0)"))).toEqual(["x values must each be ≤ 10000 bps"]);
    });
    it("rejects the wrong number of components", () => {
      expect(validateIntent(split("(1,2,3)"))).toEqual(["x needs 4 values"]);
    });
    it("rejects non-numeric components", () => {
      expect(validateIntent(split("(a,b,c,d)"))).toEqual(["x values must be whole numbers"]);
    });
  });
});

describe("castCommand", () => {
  it("renders a cast send with the address, signature, args and account flags", () => {
    const cmd = castCommand(
      intent([arg("uint256", "42")], { address: ADDR, signature: "seed(uint8,uint256)" }),
    );
    expect(cmd).toContain(`cast send ${ADDR} "seed(uint8,uint256)" 42`);
    expect(cmd).toContain(`--rpc-url "$BASE_RPC" --account operator`);
  });

  it("falls back to a shell env-var placeholder when the address is missing", () => {
    const cmd = castCommand(intent([], { address: null, contractName: "Fee Router" }));
    expect(cmd).toContain("$FEEROUTER_ADDR");
  });

  it("single-quotes and escapes string args so shell metacharacters reach cast verbatim", () => {
    const cmd = castCommand(intent([arg("string", "a'b$c")], { address: ADDR }));
    expect(cmd).toContain("'a'\\''b$c'");
  });

  it("single-quotes tuple literals so the parens aren't interpreted by the shell", () => {
    const cmd = castCommand(
      intent([arg("(uint16,uint16,uint16,uint16)", "(4000,1000,2000,3000)")], { address: ADDR }),
    );
    expect(cmd).toContain("'(4000,1000,2000,3000)'");
  });

  it("appends a --value flag only for a non-zero ETH value", () => {
    expect(castCommand(intent([], { address: ADDR, value: "1000" }))).toContain("--value 1000");
    expect(castCommand(intent([], { address: ADDR, value: "0" }))).not.toContain("--value");
  });
});
