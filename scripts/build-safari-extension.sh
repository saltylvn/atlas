#!/usr/bin/env bash
# Wraps extension/safari in a Mac app project with Apple's converter, then opens it in
# Xcode for signing and running. Needs the full Xcode (Mac App Store), not only the
# command line tools. See extension/safari/README.md.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${ATLAS_AUTOFILL_DIR:-$HOME/AtlasAutofill}"

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Xcode is needed. Install it from the Mac App Store, open it once, then run:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

python3 "$here/extension/safari/make-icons.py" >/dev/null
xcrun safari-web-extension-converter "$here/extension/safari" \
  --project-location "$out" \
  --app-name "Atlas Autofill" \
  --bundle-identifier "com.saltylvn.atlas-autofill" \
  --macos-only \
  --copy-resources \
  --no-prompt \
  --force
echo "Project written to $out. Opening it in Xcode: choose your team under Signing & Capabilities, then press Run."
open "$out/Atlas Autofill/Atlas Autofill.xcodeproj"
