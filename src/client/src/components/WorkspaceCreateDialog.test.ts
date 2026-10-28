// @vitest-environment happy-dom
import { installNativeDialogFake } from "./nativeDialog.testSupport";
installNativeDialogFake();

import { afterEach, describe, expect, it, vi } from "vitest";
import { localization } from "../localization/browser";
import { WorkspaceCreateDialog, type WorkspaceCreateDraft } from "./WorkspaceCreateDialog";
import { dialogSection, requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";

afterEach(async () => {
  document.body.replaceChildren();
  localStorage.clear();
  await localization.setPreferences({ language: "en", formatLocale: "en" });
});

describe("workspace-create-dialog", () => {
  it("defaults the base ref and branch name, and submits the trimmed draft", async () => {
    const dialog = await mountDialog({ defaultBaseRef: "main" });
    const onSubmit = vi.fn((draft: WorkspaceCreateDraft) => { void draft; });
    dialog.onSubmit = onSubmit;

    expect(baseRefInput(dialog).value).toBe("main");
    expect(submitButton(dialog).disabled).toBe(true);
    expect(deepText(dialog)).toContain("Defaults to the current branch (main)");

    typeInto(nameInput(dialog), "  feature-x  ");
    await settleRenderedDialog(dialog);
    expect(deepText(dialog)).toContain("Defaults to the worktree name (feature-x)");
    expect(branchNameInput(dialog).placeholder).toBe("feature-x");
    expect(submitButton(dialog).disabled).toBe(false);

    submitButton(dialog).click();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "feature-x", baseRef: "main", branchName: "feature-x" });
  });

  it("keeps an explicit branch name and base ref, including a cleared base ref", async () => {
    const dialog = await mountDialog({ defaultBaseRef: "main" });
    const onSubmit = vi.fn((draft: WorkspaceCreateDraft) => { void draft; });
    dialog.onSubmit = onSubmit;

    typeInto(nameInput(dialog), "wt");
    typeInto(baseRefInput(dialog), "release/2026");
    typeInto(branchNameInput(dialog), "explicit-branch");
    await settleRenderedDialog(dialog);
    submitButton(dialog).click();
    expect(onSubmit).toHaveBeenLastCalledWith({ name: "wt", baseRef: "release/2026", branchName: "explicit-branch" });

    typeInto(baseRefInput(dialog), "");
    await settleRenderedDialog(dialog);
    submitButton(dialog).click();
    expect(onSubmit).toHaveBeenLastCalledWith({ name: "wt", baseRef: "", branchName: "explicit-branch" });
  });

  it("keeps the submit button disabled for a blank name and surfaces creation errors", async () => {
    const dialog = await mountDialog();
    const onSubmit = vi.fn((draft: WorkspaceCreateDraft) => { void draft; });
    dialog.onSubmit = onSubmit;

    typeInto(nameInput(dialog), "   ");
    await settleRenderedDialog(dialog);
    expect(submitButton(dialog).disabled).toBe(true);
    expect(submitButton(dialog).title).toBe("Enter a name");
    submitButton(dialog).click();
    expect(onSubmit).not.toHaveBeenCalled();

    dialog.error = "Unable to create worktree feature-x (exit 128): already exists";
    await settleRenderedDialog(dialog);
    expect(dialog.shadowRoot?.querySelector("[role='alert']")?.textContent).toContain("already exists");
  });

  it("localizes its labels and busy state", async () => {
    const dialog = await mountDialog({ defaultBaseRef: "main" });
    const english = { heading: deepText(dialog), label: dialogSection(dialog).getAttribute("aria-label") };

    await localization.setPreferences({ language: "en-XA", formatLocale: "en-US" });
    await settleRenderedDialog(dialog);

    expect(deepText(dialog)).not.toBe(english.heading);
    expect(dialogSection(dialog).getAttribute("aria-label")).not.toBe(english.label);
    expect(closeButton(dialog).getAttribute("aria-label")).not.toBe("Close");

    dialog.loading = true;
    await settleRenderedDialog(dialog);
    expect(submitButton(dialog).disabled).toBe(true);
    expect(submitButton(dialog).textContent).not.toBe(english.label);
  });
});

async function mountDialog(options: { defaultBaseRef?: string } = {}): Promise<WorkspaceCreateDialog> {
  const dialog = new WorkspaceCreateDialog();
  dialog.defaultBaseRef = options.defaultBaseRef ?? "";
  dialog.onClose = vi.fn();
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function nameInput(dialog: WorkspaceCreateDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input")[0], "worktree name input");
}

function baseRefInput(dialog: WorkspaceCreateDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input")[1], "base ref input");
}

function branchNameInput(dialog: WorkspaceCreateDialog): HTMLInputElement {
  return requiredElement(dialog.shadowRoot?.querySelectorAll<HTMLInputElement>("input")[2], "branch name input");
}

function submitButton(dialog: WorkspaceCreateDialog): HTMLButtonElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("footer button.primary"), "submit button");
}

function closeButton(dialog: WorkspaceCreateDialog): HTMLButtonElement {
  return requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("header button"), "close button");
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

/** Light-DOM text including the nested modal surface's slot content. */
function deepText(host: HTMLElement): string {
  return host.shadowRoot?.textContent ?? "";
}
