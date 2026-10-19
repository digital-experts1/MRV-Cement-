#!/bin/bash
set -Eeuo pipefail
umask 077
export PATH=/opt/cpanel/ea-nodejs22/bin:/usr/local/bin:/usr/bin:/bin
export GIT_TERMINAL_PROMPT=0
[[ $(id -un) == cementmrv ]] || { echo 'Run as cementmrv'; exit 1; }
command=${SSH_ORIGINAL_COMMAND:-}
[[ "$command" =~ ^deploy\ ([a-f0-9]{40})$ ]] || { echo 'Only deploy SHA is allowed'; exit 1; }
sha=${BASH_REMATCH[1]}
base=/home/cementmrv/deployment
exec 9>"$base/deploy.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
[[ -L "$base/current" && -s "$base/shared/.env.local" ]]
previous=$(readlink -f "$base/current")
if [[ -f "$previous/public/deployment-version.txt" ]] && [[ $(cat "$previous/public/deployment-version.txt") == "$sha" ]]; then
  echo "Already deployed $sha"; exit 0
fi
release=$(mktemp -d "$base/releases/${sha:0:12}.XXXXXX")
staging_pid=
switched=0
health() {
  local port=$1 expected=$2
  for attempt in {1..30}; do
    if [[ $(curl -fsS --max-time 3 "http://127.0.0.1:$port/deployment-version.txt" 2>/dev/null || true) == "$expected" ]] &&
       curl -fsS --max-time 5 "http://127.0.0.1:$port/overview" -o /dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
cleanup() {
  rc=$?
  trap - EXIT
  if [[ -n "$staging_pid" ]]; then kill "$staging_pid" 2>/dev/null || true; wait "$staging_pid" 2>/dev/null || true; fi
  if (( rc != 0 && switched == 1 )); then
    echo "Deployment failed; restoring $previous"
    ln -s "$previous" "$base/rollback.$$"
    mv -Tf "$base/rollback.$$" "$base/current"
    sudo -n /usr/bin/systemctl restart cementmrv.service || true
    recovered=0
    for attempt in {1..30}; do
      if curl -fsS --max-time 3 http://127.0.0.1:3010/overview -o /dev/null; then recovered=1; break; fi
      sleep 1
    done
    [[ "$recovered" == 1 ]] && echo 'Previous release restored' || echo 'ERROR: rollback health check failed'
  fi
  (( rc == 0 )) || echo "Failed release retained for inspection: $release"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Public repository: no GitHub credential is stored on the server.
git clone --depth 1 --single-branch --branch main https://github.com/digital-experts1/MRV-Cement-.git "$release"
cd "$release"
[[ $(git rev-parse HEAD) == "$sha" ]] || { echo 'main advanced; deploy the latest workflow run'; exit 1; }
cp "$base/shared/.env.local" .env.local
# Keep credentials out of output. Explicit deployment config avoids a silent dev-project fallback.
node <<'JS'
const fs = require('fs');
const env = require('node:util').parseEnv(fs.readFileSync('.env.local', 'utf8'));
for (const key of ['DOWNLOAD_SIGNING_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
  if (!env[key]) throw new Error(`Configure ${key} in deployment/shared/.env.local`);
}
if (env.DOWNLOAD_SIGNING_SECRET.length < 32) throw new Error('Signing secret must be at least 32 characters');
if (!env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) throw new Error('Supabase URL must use HTTPS');
JS
npm ci --include=dev
npm test
mkdir -p public
printf '%s\n' "$sha" > public/deployment-version.txt
npm run build
if [[ -n $(ss -H -ltn 'sport = :3011') ]]; then echo 'Staging port 3011 occupied'; exit 1; fi
NODE_ENV=production node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3011 > "$base/staging.log" 2>&1 &
staging_pid=$!
health 3011 "$sha" || { tail -60 "$base/staging.log"; exit 1; }
kill "$staging_pid"
wait "$staging_pid" || true
staging_pid=
ln -s "$release" "$base/next.$$"
switched=1
mv -Tf "$base/next.$$" "$base/current"
sudo -n /usr/bin/systemctl restart cementmrv.service
health 3010 "$sha"
switched=0
printf '%s\n' "$previous" > "$base/previous-release"
echo "Deployed $sha successfully. Previous release: $previous"
# Releases are retained; no automatic deletion or database migrations.
