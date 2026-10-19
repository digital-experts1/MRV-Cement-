#!/bin/bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run this installer as root'; exit 1; }
source_dir=$(cd "$(dirname "$0")" && pwd)
base=/home/cementmrv/deployment
unit_dir=/etc/systemd/system/cementmrv.service.d
sudo_file=/etc/sudoers.d/cementmrv-deploy
key=/root/cementmrv-actions-key
for path in "$base" "$unit_dir/20-deployment.conf" "$sudo_file" "$key" /usr/local/bin/cementmrv-deploy; do
  [[ ! -e "$path" ]] || { echo "Already exists: $path (no files changed)"; exit 1; }
done
test -s /home/cementmrv/mrv-app/.next/BUILD_ID
test -s /home/cementmrv/mrv-app/.env.local
test -x /usr/bin/systemctl
command -v sudo >/dev/null
command -v visudo >/dev/null
command -v flock >/dev/null
bash -n "$source_dir/server-deploy.sh"
backup=$(mktemp -d /root/cement-deployment-backup.XXXXXX)
cp -a /etc/systemd/system/cementmrv.service "$backup/"
getent passwd cementmrv > "$backup/account.txt"
install -d -o cementmrv -g cementmrv -m 700 "$base" "$base/releases" "$base/shared"
install -o cementmrv -g cementmrv -m 600 /home/cementmrv/mrv-app/.env.local "$base/shared/.env.local"
runuser -u cementmrv -- ln -s /home/cementmrv/mrv-app "$base/current"
install -o root -g root -m 755 "$source_dir/server-deploy.sh" /usr/local/bin/cementmrv-deploy
printf '%s\n' 'cementmrv ALL=(root) NOPASSWD: /usr/bin/systemctl restart cementmrv.service' > "$backup/sudoers"
visudo -cf "$backup/sudoers"
install -o root -g root -m 440 "$backup/sudoers" "$sudo_file"
mkdir -p "$unit_dir"
cat > "$unit_dir/20-deployment.conf" <<'UNIT'
[Service]
WorkingDirectory=/home/cementmrv/deployment/current
ExecStart=
ExecStart=/opt/cpanel/ea-nodejs22/bin/node /home/cementmrv/deployment/current/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3010
UNIT
systemctl daemon-reload
# Give this account an SSH-capable shell. The Actions key is forced to deploy only.
usermod -s /bin/bash cementmrv
ssh-keygen -t ed25519 -N '' -C 'cementmrv-github-actions' -f "$key" >/dev/null
install -d -o cementmrv -g cementmrv -m 700 /home/cementmrv/.ssh
if [[ -f /home/cementmrv/.ssh/authorized_keys ]]; then cp -p /home/cementmrv/.ssh/authorized_keys "$backup/authorized_keys"; fi
printf 'restrict,command="/usr/local/bin/cementmrv-deploy" %s\n' "$(cat "$key.pub")" >> /home/cementmrv/.ssh/authorized_keys
chown cementmrv:cementmrv /home/cementmrv/.ssh/authorized_keys
chmod 600 /home/cementmrv/.ssh/authorized_keys
port=$(/usr/sbin/sshd -T | awk '$1 == "port" {print $2; exit}')
[[ -n "$port" ]]
echo 'SERVER SETUP COMPLETE. The running app has not been restarted.'
echo "Backup: $backup"
echo 'CEMENT_DEPLOY_HOST=5.9.99.106'
echo "CEMENT_DEPLOY_PORT=$port"
echo "Private key stored at $key — copy directly to GitHub CEMENT_DEPLOY_KEY; never paste into chat."
echo 'CEMENT_KNOWN_HOSTS (public host keys, verified from this server):'
for pub in /etc/ssh/ssh_host_*_key.pub; do
  read -r kind data comment < "$pub"
  if [[ "$port" == 22 ]]; then printf '5.9.99.106 %s %s\n' "$kind" "$data";
  else printf '[5.9.99.106]:%s %s %s\n' "$port" "$kind" "$data"; fi
done
echo "Before first deployment, configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in $base/shared/.env.local."
echo 'Use an intentionally selected project. No database migrations run during deployment.'
