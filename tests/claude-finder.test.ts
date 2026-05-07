import { describe, expect, it } from "vitest";
import { validateClaude } from "../main/claude-finder";

describe("validateClaude", () => {
  it("rejects an empty candidate", async () => {
    await expect(validateClaude("")).resolves.toMatchObject({ ok: false, version: null });
  });

  it("rejects a missing executable", async () => {
    const result = await validateClaude("/definitely/not/a/real/claude");
    expect(result.ok).toBe(false);
    expect(result.version).toBeNull();
  });
});
