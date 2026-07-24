# dmgbuild layout for the Flow install window (drag-to-Applications).
# Consumed by dist.sh via the dmgbuild Python API:
#   dmgbuild.build_dmg("dist/Flow.dmg", "Flow", settings_file="tools/dmg-settings.py",
#                      defines={"app": "dist/Flow.app", "background": "Resources/dmg-background.png"})
# Headless — dmgbuild writes the window's .DS_Store directly, no Finder/AppleScript.
# Icon positions here MUST match the arrow drawn in tools/make-dmg-bg.swift.
import os.path

application = defines.get("app", "dist/Flow.app")  # noqa: F821 (dmgbuild injects `defines`)
appname = os.path.basename(application)

# --- contents ---------------------------------------------------------------
files = [application]
symlinks = {"Applications": "/Applications"}

# --- window + icon-view -----------------------------------------------------
format = "UDZO"          # compressed, matches the previous hdiutil output
size = None              # auto-fit to contents

background = defines.get("background", "Resources/dmg-background.png")  # noqa: F821

window_rect = ((300, 200), (660, 420))   # ((screen x, y), (width, height))
default_view = "icon-view"
icon_size = 128
text_size = 13
label_pos = "bottom"

icon_locations = {
    appname: (180, 250),
    "Applications": (480, 250),
}

# Chrome off — a clean install canvas.
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
arrange_by = None
