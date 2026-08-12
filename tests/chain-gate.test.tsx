// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ScreenErrorBoundary, ChainGate, ChainSkeleton } from "@/components/game/ChainGate";
import type { ChainStatus } from "@/components/game/state";

afterEach(cleanup);

// ChainGate reads status via useGame(); stub the module so each status can be driven directly
// without standing up the whole provider tree.
let mockState: { status: ChainStatus; error?: string } = { status: "ready" };
vi.mock("@/components/game/state", () => ({
  useGame: () => ({ state: mockState }),
}));

describe("ScreenErrorBoundary actually catches", () => {
  function Boom(): React.ReactNode {
    throw new Error("kaboom from a screen");
  }

  it("renders the fallback instead of unmounting the app", () => {
    // React logs the caught error; silence it so the run stays readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ScreenErrorBoundary>
        <Boom />
      </ScreenErrorBoundary>,
    );
    expect(screen.getByText(/that screen fell over/i)).toBeTruthy();
    // The real message is surfaced, not swallowed — otherwise debugging starts from nothing.
    expect(screen.getByText(/kaboom from a screen/i)).toBeTruthy();
    spy.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ScreenErrorBoundary>
        <div>the actual screen</div>
      </ScreenErrorBoundary>,
    );
    expect(screen.getByText("the actual screen")).toBeTruthy();
    expect(screen.queryByText(/fell over/i)).toBeNull();
  });

  it("recovers when Try again is pressed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return <div>recovered</div>;
    }
    const onReset = vi.fn(() => {
      shouldThrow = false;
    });
    render(
      <ScreenErrorBoundary onReset={onReset}>
        <Flaky />
      </ScreenErrorBoundary>,
    );
    expect(screen.getByText(/fell over/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/try again/i));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByText("recovered")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("ChainGate never shows unknown state as zero", () => {
  it("renders children only when ready", () => {
    mockState = { status: "ready" };
    render(<ChainGate>{<div>your 12 letters</div>}</ChainGate>);
    expect(screen.getByText("your 12 letters")).toBeTruthy();
  });

  // The danger: a player with a full bag seeing an empty one because a read is in flight.
  it("hides children while loading rather than rendering an empty collection", () => {
    mockState = { status: "loading" };
    render(<ChainGate>{<div>your 12 letters</div>}</ChainGate>);
    expect(screen.queryByText("your 12 letters")).toBeNull();
    expect(screen.getByText(/reading the chain/i)).toBeTruthy();
  });

  it("asks for a wallet instead of showing an empty bag", () => {
    mockState = { status: "no-wallet" };
    const connect = vi.fn();
    render(<ChainGate connect={connect}>{<div>your 12 letters</div>}</ChainGate>);
    expect(screen.queryByText("your 12 letters")).toBeNull();
    expect(screen.getByText(/connect to play/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/connect wallet/i));
    expect(connect).toHaveBeenCalled();
  });

  it("says a read failed, and says it is not a change to what you own", () => {
    mockState = { status: "error", error: "RPC unreachable" };
    render(<ChainGate>{<div>your 12 letters</div>}</ChainGate>);
    expect(screen.queryByText("your 12 letters")).toBeNull();
    expect(screen.getByText(/can't reach the chain/i)).toBeTruthy();
    expect(screen.getByText(/RPC unreachable/i)).toBeTruthy();
  });

  it("falls back to reassuring copy when there is no error detail", () => {
    mockState = { status: "error" };
    render(<ChainGate>{<div>x</div>}</ChainGate>);
    expect(screen.getByText(/not a change to what you own/i)).toBeTruthy();
  });
});

describe("ChainSkeleton", () => {
  it("shows placeholders, not zeroes", () => {
    const { container } = render(<ChainSkeleton />);
    expect(container.textContent).not.toMatch(/\b0\b/);
    expect(screen.getByText(/reading the chain/i)).toBeTruthy();
  });
});
