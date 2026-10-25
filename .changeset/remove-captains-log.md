---
"@jmfederico/pi-web": patch
---

Remove the optional Captain's Log dogfooding plugin from PI WEB and the available-package catalog. Existing installations pointing to PI WEB's shipped copy stop loading it after updating; package settings and saved data are not automatically removed. Remove its entry in Settings → Pi packages on each affected machine. Independently copied installations are unaffected.
