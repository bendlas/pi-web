---
"@jmfederico/pi-web": patch
---

Describe failed session daemon version checks without declaring the service down or recommending a restart. Retry automatically while the version is unknown, and stop replaying cached failed checks after the daemon recovers.
