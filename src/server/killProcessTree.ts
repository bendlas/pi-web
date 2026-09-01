/**
 * Best-effort termination of a process and, on POSIX systems, its entire
 * process group (the descendant tree forked by node-pty's forkpty or by
 * child_process.spawn). A fork created with setsid becomes the leader of its
 * own session and process group identified by `pid`, so a negative pid targets
 * the whole group rather than only the immediate process. This is what makes a
 * terminal deletion tear down the running command instead of leaving orphaned
 * children behind.
 *
 * Falls back to signalling the process directly when the group is already gone
 * (for example when the leader exited before its children).
 *
 * On Windows the process-group concept does not exist, so only the process
 * itself is signalled.
 */
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals = "SIGKILL"): void {
  if (pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The group leader already exited or moved out of the group; fall through
      // to a direct signal so we still attempt to stop the immediate process.
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Termination is best-effort once the process is gone.
  }
}
