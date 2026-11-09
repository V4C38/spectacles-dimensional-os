import { expect, it } from "vitest";
import { validPin } from "../../Assets/Scripts/DimOSARClient/websocket/ConnectionResolution";

it("retains leading zeros and rejects non-six-digit PINs", () => {
    expect(validPin("012345")).toBe(true);
    for (const value of ["12345", "1234567", "１２３４５６", "123 45", " 123456"]) expect(validPin(value)).toBe(false);
  });
