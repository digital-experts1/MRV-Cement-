# Cement MRV GitHub deployment

Pushes to `main` and manual workflow runs deploy the exact workflow SHA to the existing Hetzner/cPanel account. Set repository Actions variable `CEMENT_DEPLOY_ENABLED=true` only after the server and secrets are configured. Until then the job is skipped.

## One-time root setup

Fetch a reviewed copy of this repository into a temporary directory and run `bash scripts/deploy/install-server.sh` from that copy. The installer preserves `/home/cementmrv/mrv-app`, copies its environment into `/home/cementmrv/deployment/shared/.env.local`, and sets up a systemd override whose initial target is the existing app. It does not restart it. Existing installer paths cause an early stop instead of overwriting.

The installer grants the account a Bash login shell and installs a dedicated forced-command SSH key (no forwarding or interactive terminal). The only sudo permission is restarting `cementmrv.service`. Existing SSH keys are retained. Inspect WHM shell access policy if SSH denies this account; do not grant root login to Actions.

## Configuration

Edit `/home/cementmrv/deployment/shared/.env.local` on the server. Preserve `DOWNLOAD_SIGNING_SECRET`; explicitly set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Use the intentionally selected Supabase project and its publishable key, never a service-role key. The repository's development project is not implicitly selected by this deployment script. Configure that project's Auth site URL and allowed redirect URLs for the domain and application callbacks as appropriate. Deployment does not apply migrations or assert database readiness.

Create these repository Actions secrets:

- `CEMENT_DEPLOY_HOST`: `5.9.99.106`
- `CEMENT_DEPLOY_PORT`: SSH port printed by installer
- `CEMENT_DEPLOY_KEY`: complete contents of `/root/cementmrv-actions-key`; copy only to GitHub secrets
- `CEMENT_KNOWN_HOSTS`: public host-key lines printed by installer, including `[host]:port` for a nonstandard port

Ensure the server firewall permits SSH from your GitHub-hosted runner. Do not disable host-key verification. A connection timeout requires fixing network reachability; a denied login requires checking SSH/account policy.

Set `CEMENT_DEPLOY_ENABLED=true` under Actions Variables, then run **Deploy Cement MRV** manually on main. Subsequent pushes to main trigger it automatically. GitHub secrets are never stored in Git. No third-party Actions execute in this workflow.

## Deployment behavior

The forced command accepts only `deploy <40-character SHA>`. A server lock serializes deployments, in addition to Actions concurrency. It clones public main into a fresh release, refuses a SHA mismatch if main advanced, copies the private environment, runs `npm ci --include=dev`, all tests, and the Webpack production build. It starts the release on loopback port 3011, checks `/overview` and an exact version marker, then atomically switches the current symlink, restarts the service on port 3010 and repeats the checks. Build failures leave the running release untouched. Post-switch failures restore the previous symlink and restart it, reporting rollback health. There is a brief restart interruption; this is not zero-downtime deployment.

Existing Apache and SSL settings remain in place. Production backend correctness and authenticated user journeys require their own checks; these startup checks are not an end-to-end certification. No schema changes are automated.

Previous and failed releases are retained for recovery and inspection; monitor disk space and remove old releases only after confirming they are neither current nor needed for rollback. `previous-release` records the previous successful target. Service logs: `journalctl -u cementmrv`. Workflow output is in GitHub Actions. Staging logs: `/home/cementmrv/deployment/staging.log`.

Public version: `https://cementmrv.traceforce.net/deployment-version.txt`. The deployed SHA must match the successful Actions run.

PDF/Excel audit findings are separate existing work. This change preserves the server build fixes: Webpack, Node 22 types, and Next.js >=16.4.2 with a regenerated lockfile.
