# Dependabot minimatch update

The failing Dependabot run 41286071898 reports `security_update_not_possible` for
GHSA-g3hv-75wg-m249: the reviewed advisory lists versions below 11.0.1, while
ESLint and several plugins still require the callable minimatch 3 API.
The most recent main-branch Verify and Deploy runs both succeeded. Rerunning the
same Dependabot job without changing the dependency graph will not fix resolution.

This patch scopes a patched minimatch 11.0.4+ override to
`@typescript-eslint/typescript-estree`. That consumer uses the named `minimatch`
function with `{ dot: true }`; compatibility tests cover that exact API and
confirm that legacy React lint rules retain their callable CommonJS API.

A global override is unsafe: minimatch 11 does not implement the callable default
export or `makeRe()` used by the older plugins. Those dependencies remain on
3.1.5. This change is partial remediation, not closure of the Dependabot finding.
Do not disable Dependabot or dismiss its alert to make the Actions list green.

Upstream clarification of the advisory's pre-7 affected range is still pending.
The issue below provides source analysis but is not an authoritative exclusion.
Until the advisory is corrected or compatible upstream packages are released,
keep the remaining finding open. No production application dependency changes.

References:
- https://github.com/digital-experts1/MRV-Cement-/actions/runs/41286071898
- https://github.com/advisories/GHSA-g3hv-75wg-m249
- https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249
- https://github.com/github/advisory-database/issues/10811
