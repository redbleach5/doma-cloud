/**
 * Pure helpers of src/lib/cloud/upload-core.ts — the shared upload/quota
 * logic used by BOTH upload endpoints. DB-touching parts
 * (enforceQuotaAtomically, rollbackStoredFiles, persistMultipartFiles) are
 * covered indirectly by the upload integration tests.
 */
import { describe, expect, it } from "bun:test";
import { quotaExceededDetail, quotaWouldExceed } from "@/lib/cloud/upload-core";

const GB = 1024n * 1024n * 1024n;
const account = { id: "u1", quotaBytes: 10n * GB, usedBytes: 9n * GB };

describe("quotaWouldExceed", () => {
  it("allows uploads up to exactly the quota boundary", () => {
    expect(quotaWouldExceed(account, 1n * GB)).toBe(false);
  });

  it("rejects anything past the boundary", () => {
    expect(quotaWouldExceed(account, 1n * GB + 1n)).toBe(true);
    expect(quotaWouldExceed(account, 2n * GB)).toBe(true);
  });

  it("accepts number or bigint incoming sizes", () => {
    expect(quotaWouldExceed(account, Number(GB))).toBe(false);
  });
});

describe("quotaExceededDetail", () => {
  it("stringifies bigints and keeps incoming as a number", () => {
    expect(quotaExceededDetail(account, 2048)).toEqual({
      quota: (10n * GB).toString(),
      used: (9n * GB).toString(),
      incoming: 2048,
    });
  });
});
