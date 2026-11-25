#!/usr/bin/env bash
# Wraps extension/safari in a Mac app project with Apple's converter, then opens it in
# Xcode for signing and running. Needs the full Xcode (Mac App Store), not only the
# command line tools. See extension/safari/README.md.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${ATLAS_AUTOFILL_DIR:-$HOME/engineering-projects/AtlasAutofill}"

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Xcode is needed. Install it from the Mac App Store, open it once, then run:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

python3 "$here/extension/safari/make-icons.py" >/dev/null

# A project that already exists keeps its signing choice: only the extension's own files are
# copied into it. Pass --fresh to build the project again from nothing.
resources="$out/Atlas Autofill/Atlas Autofill Extension/Resources"
project="$out/Atlas Autofill/Atlas Autofill.xcodeproj"
if [ -d "$resources" ] && [ -d "$project" ] && [ "${1:-}" != "--fresh" ]; then
  cp -R "$here/extension/safari/." "$resources/"
  # The project lists its files one by one: add any new one, so it is bundled.
  for f in "$project"/project.*proj; do
    [ -f "$f" ] && python3 - "$f" "$here/extension/safari" <<'PY'
import os, sys
path, src = sys.argv[1], sys.argv[2]
text = open(path).read()
anchor = '{ "path": "Resources/manifest.json", "target-membership": [ "Atlas Autofill Extension/resources" ] },'
if anchor not in text:
    sys.exit(0)
added = []
for name in sorted(os.listdir(src)):
    if name.startswith(".") or not os.path.isfile(os.path.join(src, name)):
        continue
    entry = '{ "path": "Resources/%s", "target-membership": [ "Atlas Autofill Extension/resources" ] },' % name
    if '"Resources/%s"' % name not in text:
        text = text.replace(anchor, anchor + "\n            " + entry)
        added.append(name)
open(path, "w").write(text)
if added:
    print("Added to the Xcode project:", ", ".join(added))
PY
  done
  echo "Updated the extension's files in $out. In Xcode, press Run to install the new version."
  open "$project"
  exit 0
fi

xcrun safari-web-extension-converter "$here/extension/safari" \
  --project-location "$out" \
  --app-name "Atlas Autofill" \
  --bundle-identifier "com.saltylvn.atlas-autofill" \
  --macos-only \
  --copy-resources \
  --no-prompt \
  --force

# The converter capitalizes the app's identifier ("com.saltylvn.Atlas-Autofill") but not the
# extension's ("com.saltylvn.atlas-autofill.Extension"). Xcode then refuses to run it: an
# extension's identifier must start with its app's. Put the app's back to lowercase.
for f in "$out/Atlas Autofill/Atlas Autofill.xcodeproj/"project.*proj; do
  [ -f "$f" ] && sed -i '' 's/"*com\.saltylvn\.Atlas-Autofill"*\([;,]\)/"com.saltylvn.atlas-autofill"\1/g' "$f"
done
echo "Project written to $out. Opening it in Xcode: choose your team under Signing & Capabilities, then press Run."
open "$out/Atlas Autofill/Atlas Autofill.xcodeproj"
