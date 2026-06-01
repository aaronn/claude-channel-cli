import type { EndpointCandidate } from "../registry/endpoint-record.js";

export function formatEndpointList(candidates: EndpointCandidate[]): string {
  if (candidates.length === 0) {
    return "No live Claude Code channel endpoints found.\n";
  }

  const rows = candidates.map((candidate) => ({
    index: String(candidate.index),
    target: candidate.target,
    name: candidate.display_name,
    project: candidate.project_dir,
    pid: String(candidate.pid),
    seen: `${candidate.last_seen_seconds}s`,
  }));

  const widths = {
    index: width(["#", ...rows.map((row) => row.index)]),
    target: width(["TARGET", ...rows.map((row) => row.target)]),
    name: width(["NAME", ...rows.map((row) => row.name)]),
    project: width(["PROJECT", ...rows.map((row) => row.project)]),
    pid: width(["PID", ...rows.map((row) => row.pid)]),
    seen: width(["SEEN", ...rows.map((row) => row.seen)]),
  };

  const lines = [
    [
      pad("#", widths.index),
      pad("TARGET", widths.target),
      pad("NAME", widths.name),
      pad("PROJECT", widths.project),
      pad("PID", widths.pid),
      pad("SEEN", widths.seen),
    ].join("  "),
    ...rows.map((row) => [
      pad(row.index, widths.index),
      pad(row.target, widths.target),
      pad(row.name, widths.name),
      pad(row.project, widths.project),
      pad(row.pid, widths.pid),
      pad(row.seen, widths.seen),
    ].join("  ")),
  ];

  return `${lines.join("\n")}\n`;
}

export function formatAmbiguousTargets(candidates: EndpointCandidate[]): string {
  return [
    "Multiple Claude Code channel endpoints are running. Specify a target:",
    formatEndpointList(candidates).trimEnd(),
  ].join("\n");
}

function width(values: string[]): number {
  return Math.max(...values.map((value) => value.length));
}

function pad(value: string, size: number): string {
  return value.padEnd(size, " ");
}
