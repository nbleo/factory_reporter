"""One-shot GitHub setup for Factory Reporter.

    GITHUB_TOKEN=<pat> python scripts/setup_github.py

What it does
------------
1. Resolves (or creates) two repositories:
     * factory_reporter       PUBLIC   - the PWA source, published with GitHub Pages
     * factory_reporter_data  PRIVATE  - where the phone syncs visit reports
2. Pushes the working tree **through the GitHub REST API**
   (git-over-HTTPS is blocked on this network; api.github.com is not).
3. Switches GitHub Pages on with "GitHub Actions" as the build source.

Notes
-----
* The token is read from the environment only - never written to disk,
  never stored in .git/config.
* Only files tracked by git are uploaded, so `.gitignore`d items stay local.
* A read-only token cannot write: the script stops with an actionable
  message instead of failing half-way.
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import push_via_api as P  # noqa: E402

WRITE_HINT = ("Your token can read but not write. Generate a new one with\n"
              "  Repository permissions -> Contents: Read and write, Pages: Read and write\n"
              "  Repository access      -> All repositories\n"
              "(a fine-grained token limited to 'Only select repositories' cannot create\n"
              " a new private repository and then read it back).")

DATA_README = """# Factory Reporter - private visit records

Written by the Factory Reporter PWA. **Keep this repository private.**

## Layout - one namespace per person

    users/<github-login>/reports/index.json                        list of reports (with tombstones)
    users/<github-login>/reports/<report-id>/report.json            one visit report
    users/<github-login>/reports/<report-id>/photos/<photo-id>.jpg  compressed photos

`report-id` is `<YYYYMMDD>-<factory-slug>-<4 random chars>`, so the folder is
readable in the GitHub web UI.

Each person writes only under their own `users/<login>/` prefix, so several
people can share one private repository without overwriting each other.

## Access control

* Read access = repository access. Add someone at
  **Settings -> Collaborators -> Add people** - do *not* make this repo public.
* The app refuses to upload to a public repository, and refuses the public
  code repository outright.

## What does NOT belong here

Anything about the program itself. The app source lives in the public repo and
is deployed with GitHub Pages; visit records must never be pushed there.
"""

DATA_GITIGNORE = """.DS_Store
Thumbs.db
*.tmp
"""


def resolve_repo(token: str, owner: str, name: str, private: bool, desc: str) -> dict | None:
    """Return the repo dict, or None if it does not exist / cannot be created."""
    status, body = P.api("GET", f"/repos/{owner}/{name}", token)
    if status == 200 and isinstance(body, dict):
        print(f"  {body['full_name']}  (private={body['private']})  [exists]")
        return body

    status, body = P.api("POST", "/user/repos", token,
                         {"name": name, "private": private, "description": desc,
                          "auto_init": private})
    if status in (200, 201) and isinstance(body, dict):
        print(f"  {body['full_name']}  (private={body['private']})  [created]")
        return body

    print(f"  {owner}/{name}: not found and cannot be created (HTTP {status} {body})")
    return None


def seed_data_repo(token: str, owner: str, repo: str, branch: str) -> None:
    """Give the private store a README + .gitignore so the first sync has a base."""
    for path, text in (("README.md", DATA_README), (".gitignore", DATA_GITIGNORE)):
        status, _ = P.api("GET", f"/repos/{owner}/{repo}/contents/{path}", token)
        if status == 200:
            print(f"  {path}: already present")
            continue
        status, body = P.api("PUT", f"/repos/{owner}/{repo}/contents/{path}", token, {
            "message": f"Initialise private store ({path})",
            "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "branch": branch,
        })
        print(f"  {path}: {'created' if status in (200, 201) else f'FAILED {status} {body}'}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", default="", help="GitHub account (defaults to the token owner)")
    ap.add_argument("--code-repo", default="factory_reporter", help="public repo holding the PWA")
    ap.add_argument("--data-repo", default="factory_reporter_data", help="private repo holding records")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--message", default="Factory Reporter: factory visit reports with PDF export")
    ap.add_argument("--skip-push", action="store_true")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        raise SystemExit("Set GITHUB_TOKEN first, e.g.\n"
                         "  GITHUB_TOKEN=<pat> python scripts/setup_github.py")

    status, me = P.api("GET", "/user", token)
    if status != 200 or not isinstance(me, dict):
        raise SystemExit(f"cannot authenticate: HTTP {status} {me}")
    owner = args.owner or me["login"]
    print(f"authenticated as {me['login']}  ->  owner '{owner}'\n")

    if args.data_repo.lower() == args.code_repo.lower():
        raise SystemExit("Refusing to run: --data-repo and --code-repo are the same.\n"
                         "The code repo is public (GitHub Pages serves it to anyone) while\n"
                         "visit records must live in a separate PRIVATE repository.")

    print("repositories")
    code = resolve_repo(token, owner, args.code_repo, private=False,
                        desc="Offline factory visit reports with one-tap PDF export (code only)")
    if code is None:
        raise SystemExit(f"Create the public repo first: https://github.com/new  name={args.code_repo}")

    data = resolve_repo(token, owner, args.data_repo, private=True,
                        desc="Factory Reporter visit records - private backup store")
    if data is None:
        print(f"  -> the name may already be taken but invisible to this token.\n"
              f"     Open https://github.com/{owner}/{args.data_repo} in a browser:\n"
              f"       * if it exists  -> add it to the token's repository access list\n"
              f"       * if 404        -> create it at https://github.com/new (Private)")
    data_branch = (data or {}).get("default_branch", "main")
    if data is not None:
        print("\nseeding the private store")
        seed_data_repo(token, owner, args.data_repo, data_branch)

    if args.skip_push:
        print("skipping push (--skip-push)")
        return 0

    print(f"\npushing {owner}/{args.code_repo} via the REST API (git protocol is not used)")
    rc = P.push(f"{owner}/{args.code_repo}", args.branch, args.message, token)
    if rc != 0:
        raise SystemExit("push failed.\n" + WRITE_HINT)

    print(f"\npublishing app/ to the gh-pages branch")
    rc = P.publish_pages(f"{owner}/{args.code_repo}", "gh-pages", args.message, token)
    if rc != 0:
        raise SystemExit("could not publish the Pages branch")
    P.enable_pages(f"{owner}/{args.code_repo}", "gh-pages", token)

    print()
    print("Two repositories, two jobs:")
    print(f"  PUBLIC  {owner}/{args.code_repo:<24} program only -> Pages")
    print(f"  PRIVATE {owner}/{args.data_repo:<24} visit records, per-person namespaces")
    print()
    print("Fill in the app's Settings screen with:")
    print(f"  owner  = {owner}")
    print(f"  repo   = {args.data_repo}   <-- private")
    print(f"  branch = {data_branch}")
    print()
    print(f"PWA URL (live after the workflow finishes): "
          f"https://{owner}.github.io/{args.code_repo}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
