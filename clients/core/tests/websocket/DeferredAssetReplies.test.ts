import { expect, it, vi } from "vitest";
import { DeferredAssetReplies } from "../../src/websocket/DeferredAssetReplies";
import { BulkTransfer } from "../../src/websocket/BulkTransfer";

function fixture() {
  let now = 0;
  const bulk = new BulkTransfer({ now: () => now }, () => {}, () => {}, () => {});
  const hydrate = vi.spyOn(bulk, "hydrate").mockImplementation(value => ({ value, pending: true, unavailable: false }));
  const retire = vi.fn();
  const replies = new DeferredAssetReplies({ now: () => now }, bulk, vi.fn(), retire, vi.fn());
  return { replies, hydrate, retire, advance: (seconds: number) => { now += seconds; } };
}

it("bounds correlations while allowing replacement and reclaiming dropped capacity", () => {
  const { replies } = fixture();
  for (let i = 0; i < 64; i++) replies.defer({ request_id: String(i) }, 10);
  expect(() => replies.defer({ request_id: "overflow" }, 10)).toThrow("budget");
  expect(() => replies.defer({ request_id: "0" }, 20)).not.toThrow();
  expect(replies.deadline("0")).toBe(20);
  replies.drop("1");
  expect(() => replies.defer({ request_id: "new" }, 10)).not.toThrow();
});

it("expires pending correlations and frees their capacity", () => {
  const f = fixture();
  for (let i = 0; i < 64; i++) f.replies.defer({ request_id: String(i) }, 1);
  f.advance(1);
  f.replies.tick(1);
  expect(f.retire).toHaveBeenCalledTimes(64);
  expect(() => f.replies.defer({ request_id: "new" }, 10)).not.toThrow();
});

it("rotates pending work fairly across four-attempt passes", () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.replies.defer({ request_id: String(i) }, 10);
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(4);
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(8);
  f.replies.tick(0);
  expect(new Set(f.hydrate.mock.calls.map(([value]) => value.request_id)).size).toBe(9);
});

it("stops hydration when the processing time budget is consumed", () => {
  const f = fixture();
  f.replies.defer({ request_id: "a" }, 10);
  f.replies.defer({ request_id: "b" }, 10);
  f.hydrate.mockImplementation(value => {
    f.advance(.002);
    return { value, pending: true, unavailable: false };
  });
  f.replies.tick(0);
  expect(f.hydrate).toHaveBeenCalledTimes(1);
  f.replies.tick(.002);
  expect(f.hydrate.mock.calls[1][0].request_id).toBe("b");
});
