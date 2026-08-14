import { describe, expect, it } from "vitest";
import { formatDoctorReport, type DoctorCheck } from "./doctor.js";

describe("formatDoctorReport", () => {
  it("summarizes pass, warning, and failure checks", () => {
    const checks: DoctorCheck[] = [
      { id: "a", label: "Config", status: "pass", detail: "valid" },
      { id: "b", label: "Docker", status: "warn", detail: "disabled", fix: "Enable Docker" },
      { id: "c", label: "Provider", status: "fail", detail: "missing key", fix: "Run setup" },
    ];

    const report = formatDoctorReport(checks);
    expect(report).toContain("OK   Config: valid");
    expect(report).toContain("WARN Docker: disabled");
    expect(report).toContain("fix: Enable Docker");
    expect(report).toContain("FAIL Provider: missing key");
    expect(report).toContain("Summary: 1 fail, 1 warn, 1 pass");
  });
});
