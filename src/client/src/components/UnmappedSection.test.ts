// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, UnmappedSessionGroup } from "../api";
import { UnmappedSection } from "./UnmappedSection";

afterEach(() => {
  document.body.replaceChildren();
});

describe("UnmappedSection", () => {
  it("renders nothing without groups", async () => {
    const section = await render({ groups: [] });

    expect(section.shadowRoot?.querySelector(".unmapped")).toBeNull();
  });

  it("expands to cwd groups with deleted and unmapped badges", async () => {
    const section = await render({ groups: [group("/gone", false), group("/still-here", true, "workspace")] });

    await showGroups(section);

    const rows = [...section.shadowRoot?.querySelectorAll<HTMLElement>(".group-row") ?? []];
    expect(rows.map((row) => row.querySelector(".group-cwd")?.textContent)).toEqual(["/gone", "/still-here"]);
    expect(rows[0]?.querySelector(".badge")?.textContent).toBe("deleted");
    expect(rows[1]?.querySelector(".badge")?.textContent).toBe("unmapped");
  });

  it("expands a group into read-only session rows and reports selection", async () => {
    const onSelectSession = vi.fn();
    const session = sessionInfo("s1", "first prompt");
    const section = await render({ groups: [group("/gone", false, "project", [session])], onSelectSession });

    await showGroups(section);
    section.shadowRoot?.querySelector<HTMLButtonElement>(".group-row")?.click();
    await section.updateComplete;
    await section.updateComplete;

    const row = section.shadowRoot?.querySelector<HTMLElement>(".session-row");
    expect(row?.querySelector(".action-name")?.textContent).toBe("first prompt");
    expect(row?.querySelector("small")?.textContent).toContain("read-only");

    row?.click();
    expect(onSelectSession).toHaveBeenCalledWith(session);
  });

  it("marks the selected session row", async () => {
    const section = await render({
      groups: [group("/gone", false, "project", [sessionInfo("s1", "one"), sessionInfo("s2", "two")])],
      selectedSessionId: "s2",
    });

    await showGroups(section);
    section.shadowRoot?.querySelector<HTMLButtonElement>(".group-row")?.click();
    await section.updateComplete;
    await section.updateComplete;

    const selected = [...section.shadowRoot?.querySelectorAll<HTMLElement>(".session-row") ?? []]
      .filter((row) => row.classList.contains("selected"));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.querySelector(".action-name")?.textContent).toBe("two");
  });
});

async function render(props: {
  groups: UnmappedSessionGroup[];
  selectedSessionId?: string;
  onSelectSession?: (session: SessionInfo) => void;
}): Promise<UnmappedSection> {
  const section = new UnmappedSection();
  section.groups = props.groups;
  section.sectionTitle = "Unmapped Projects";
  if (props.selectedSessionId !== undefined) section.selectedSessionId = props.selectedSessionId;
  if (props.onSelectSession !== undefined) section.onSelectSession = props.onSelectSession;
  document.body.append(section);
  await section.updateComplete;
  return section;
}

async function showGroups(section: UnmappedSection): Promise<void> {
  section.shadowRoot?.querySelector<HTMLButtonElement>(".section-toggle")?.click();
  await section.updateComplete;
  await section.updateComplete;
}

function group(cwd: string, exists: boolean, kind: UnmappedSessionGroup["kind"] = "project", sessions: SessionInfo[] = [sessionInfo("s1", "hello")]): UnmappedSessionGroup {
  return { cwd, kind, exists, sessions };
}

function sessionInfo(id: string, firstMessage: string): SessionInfo {
  return {
    id,
    cwd: "/gone",
    path: `/sessions/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 3,
    firstMessage,
    readOnly: true,
  };
}
