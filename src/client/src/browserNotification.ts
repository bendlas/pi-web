/**
 * Thin wrapper around the browser-native Notification API.
 *
 * pi-web already surfaces notifications in its in-app tray (the per-session
 * notification inbox). This module adds optional OS/browser-native toasts on
 * top of that, fired only while the tab is hidden so we don't duplicate the
 * in-app card the user is already looking at.
 *
 * The browser requires Notification.requestPermission() to be called from a
 * user gesture, so the permission prompt is triggered from the settings toggle
 * click handler, never from an event handler. The user's choice is persisted in
 * localStorage; native notifications only fire when enabled AND granted.
 */

const STORAGE_KEY = "piweb.browserNotifications.enabled";

export type BrowserNotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && typeof window.Notification !== "undefined";
}

export function getBrowserNotificationPermission(): BrowserNotificationPermissionState {
  if (!browserNotificationsSupported()) return "unsupported";
  const permission = window.Notification.permission;
  return permission === "granted" || permission === "denied" || permission === "default" ? permission : "default";
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  if (!browserNotificationsSupported()) return "unsupported";
  try {
    return await window.Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Whether native notifications should currently fire: enabled preference AND granted permission. */
export function areBrowserNotificationsEnabled(): boolean {
  if (!browserNotificationsSupported()) return false;
  if (getBrowserNotificationPermission() !== "granted") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Show a native browser notification, if allowed.
 *
 * Returns true when a notification was actually shown. Fires only while the tab
 * is hidden (the in-app tray already covers the focused case) and only when the
 * user has enabled native notifications and granted permission.
 */
export function showBrowserNotification(title: string, body: string, severity: "info" | "warning" | "error" = "info", suppressWhenVisible = false): boolean {
  if (!areBrowserNotificationsEnabled()) return false;
  // When the notification belongs to the session the user is actively looking at, the
  // in-app tray already shows it, so only fire natively while the tab is hidden.
  // For other sessions the user is NOT looking at, fire regardless of tab visibility.
  if (typeof document !== "undefined" && !document.hidden && suppressWhenVisible) return false;
  if (!browserNotificationsSupported()) return false;
  try {
    const notification = new window.Notification(title, {
      body,
      tag: severity === "error" ? "piweb-notification-error" : `piweb-notification-${Date.now()}`,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
