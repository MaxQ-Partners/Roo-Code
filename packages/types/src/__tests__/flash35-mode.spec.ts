// npx vitest run src/__tests__/flash35-mode.spec.ts
// Tests that flash35 is present in DEFAULT_MODES and parses through modeConfigSchema.

import { describe, it, expect } from "vitest"
import { DEFAULT_MODES, modeConfigSchema } from "../mode.js"

describe("flash35 DEFAULT_MODE entry", () => {
	const flash35 = DEFAULT_MODES.find((m) => m.slug === "flash35")

	it("should exist in DEFAULT_MODES", () => {
		expect(flash35).toBeDefined()
	})

	it("should have the correct slug", () => {
		expect(flash35?.slug).toBe("flash35")
	})

	it("should have a non-empty name", () => {
		expect(flash35?.name).toBeTruthy()
	})

	it("should have a non-empty roleDefinition", () => {
		expect(flash35?.roleDefinition).toBeTruthy()
	})

	it("should parse cleanly through modeConfigSchema.safeParse", () => {
		const result = modeConfigSchema.safeParse(flash35)
		expect(result.success).toBe(true)
		if (!result.success) {
			// Print issues for debug output in CI
			console.error("modeConfigSchema.safeParse errors:", result.error.issues)
		}
	})

	it("should have groups that are all valid group names", () => {
		const validGroupNames = ["read", "edit", "command", "mcp", "modes"]
		for (const group of flash35?.groups ?? []) {
			// Groups can be a string or a tuple [name, options]
			const groupName = Array.isArray(group) ? group[0] : group
			expect(validGroupNames).toContain(groupName)
		}
	})
})
