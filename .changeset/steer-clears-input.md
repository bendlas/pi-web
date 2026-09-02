---
"@jmfederico/pi-web": patch
---

Clear the composer input after steering the streaming response with mod+shift+enter, exactly like a normal send does. The `prompt.steer` shortcut was dispatching the steer but leaving the typed text in the composer.
