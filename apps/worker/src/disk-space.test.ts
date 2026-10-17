import { describe, expect, it } from "vitest";
import { assessDiskSpace, insufficientDiskMessage } from "./disk-space";

describe("temporary disk space guard", () => {
  it("allows a render when the configured headroom is available", () => {
    expect(assessDiskSpace(5_000_000_000, 228_000_000_000)).toMatchObject({ allowed: true, availableGb: 5 });
  });

  it("fails closed before a job can fill the disk", () => {
    const check = assessDiskSpace(1_200_000_000, 228_000_000_000);
    expect(check.allowed).toBe(false);
    expect(insufficientDiskMessage(check)).toMatch(/còn 1\.2 GB.*tối thiểu 4 GB/u);
  });
});
