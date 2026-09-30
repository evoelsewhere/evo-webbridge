#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for command_name in jq zip; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

version="$(jq -er '.version | select(type == "string" and test("^[0-9]+(\\.[0-9]+){0,3}$"))' manifest.json)"
output_path="${1:-dist/evoflux-webbridge-v${version}.zip}"

if [[ "$output_path" != /* ]]; then
  output_path="$repo_root/$output_path"
fi

package_files=(
  background.js
  sidepanel.html
  sidepanel.js
  chat-renderer.js
  markdown.js
  theme-init.js
  transcript-follow.js
  agent_control_overlay.js
  annotation.js
  element_picker.js
  region_picker.js
  page_runtime.js
  semantic_runtime.js
  teach_recorder.js
  text_watch.js
  icons
  fonts
)

for package_file in "${package_files[@]}"; do
  if [[ ! -e "$package_file" ]]; then
    echo "Package input not found: $package_file" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$output_path")"
temporary_directory="$(mktemp -d "${output_path}.tmp.XXXXXX")"
staging_directory="${temporary_directory}/extension"
temporary_zip="${temporary_directory}/extension.zip"
trap 'rm -rf -- "$temporary_directory"' EXIT

mkdir -p "$staging_directory"

# Chrome Web Store rejects the development-only manifest key. Keep it in the
# source manifest so Load unpacked has a stable ID, but omit it from Store ZIPs.
jq 'del(.key)' manifest.json > "${staging_directory}/manifest.json"
cp -R -- "${package_files[@]}" "$staging_directory/"

(
  cd "$staging_directory"
  zip -q -r "$temporary_zip" .
)

mv -f -- "$temporary_zip" "$output_path"
rm -rf -- "$temporary_directory"
trap - EXIT

echo "$output_path"
