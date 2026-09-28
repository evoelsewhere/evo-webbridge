#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <extension.zip> <upload|publish>" >&2
}

package_path="${1:-}"
release_mode="${2:-}"

if [[ ! -f "$package_path" ]] || [[ "$release_mode" != "upload" && "$release_mode" != "publish" ]]; then
  usage
  exit 1
fi

for command_name in curl jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

required_environment=(
  CHROME_PUBLISHER_ID
  CHROME_EXTENSION_ID
  CHROME_CLIENT_ID
  CHROME_CLIENT_SECRET
  CHROME_REFRESH_TOKEN
)

for variable_name in "${required_environment[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Required environment variable is missing: $variable_name" >&2
    exit 1
  fi
done

api_item_url="https://chromewebstore.googleapis.com/v2/publishers/${CHROME_PUBLISHER_ID}/items/${CHROME_EXTENSION_ID}"
api_upload_url="https://chromewebstore.googleapis.com/upload/v2/publishers/${CHROME_PUBLISHER_ID}/items/${CHROME_EXTENSION_ID}:upload"

token_response=""
if ! token_response="$(
  curl --silent --show-error --fail-with-body \
    --request POST \
    --data-urlencode "client_id=${CHROME_CLIENT_ID}" \
    --data-urlencode "client_secret=${CHROME_CLIENT_SECRET}" \
    --data-urlencode "refresh_token=${CHROME_REFRESH_TOKEN}" \
    --data-urlencode "grant_type=refresh_token" \
    https://oauth2.googleapis.com/token
)"; then
  echo "Unable to obtain a Chrome Web Store access token." >&2
  jq -r '.error_description // .error // empty' <<<"$token_response" >&2 || true
  exit 1
fi

access_token="$(jq -er '.access_token | select(type == "string" and length > 0)' <<<"$token_response")"
unset token_response

api_request() {
  curl --silent --show-error --fail-with-body \
    --header "Authorization: Bearer ${access_token}" \
    "$@"
}

echo "Uploading $(basename "$package_path") to Chrome Web Store item ${CHROME_EXTENSION_ID}..."
upload_response=""
if ! upload_response="$(
  api_request \
    --request POST \
    --header "Content-Type: application/zip" \
    --upload-file "$package_path" \
    "$api_upload_url"
)"; then
  echo "Chrome Web Store upload failed." >&2
  jq . <<<"$upload_response" >&2 || true
  exit 1
fi

upload_state="$(jq -r '.uploadState // empty' <<<"$upload_response")"

if [[ "$upload_state" == "IN_PROGRESS" || "$upload_state" == "UPLOAD_IN_PROGRESS" ]]; then
  echo "Chrome Web Store is processing the package..."
  for _ in {1..24}; do
    sleep 5
    status_response="$(api_request --request GET "${api_item_url}:fetchStatus")"
    upload_state="$(jq -r '.lastAsyncUploadState // empty' <<<"$status_response")"
    if [[ "$upload_state" != "IN_PROGRESS" && "$upload_state" != "UPLOAD_IN_PROGRESS" ]]; then
      upload_response="$status_response"
      break
    fi
  done
fi

if [[ "$upload_state" != "SUCCEEDED" ]]; then
  echo "Upload did not complete successfully (state: ${upload_state:-unknown})." >&2
  jq . <<<"$upload_response" >&2 || true
  exit 1
fi

uploaded_version="$(jq -r '.crxVersion // .itemRevisionStatus.distributionChannels[0].crxVersion // empty' <<<"$upload_response")"
echo "Upload succeeded${uploaded_version:+ for version ${uploaded_version}}."

if [[ "$release_mode" == "upload" ]]; then
  echo "The package is uploaded as a draft and has not been submitted for review."
  exit 0
fi

echo "Submitting the package for review and publishing after approval..."
publish_response=""
if ! publish_response="$(
  api_request \
    --request POST \
    --header "Content-Type: application/json" \
    --data '{"publishType":"DEFAULT_PUBLISH","blockOnWarnings":false}' \
    "${api_item_url}:publish"
)"; then
  echo "Chrome Web Store publish request failed." >&2
  jq . <<<"$publish_response" >&2 || true
  exit 1
fi

publish_state="$(jq -r '.state // empty' <<<"$publish_response")"
echo "Chrome Web Store accepted the publish request (state: ${publish_state:-unknown})."
jq '{itemId, state, warningInfo}' <<<"$publish_response"
