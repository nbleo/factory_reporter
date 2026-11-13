#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Push the local repository to GitHub **without** the git protocol.

Why this exists: on this network the plain git-over-HTTPS endpoint
(github.com:443) is blocked by the proxy while api.github.com is reachable.
This script speaks the GitHub *Git Data API* (blobs -> tree -> commit ->
update-ref) instead, so it works through the same egress path as every
other REST call.

Only files tracked by git (`git ls-files`) are uploaded, so anything in
.gitignore (.workbuddy/, config.json, test output) never leaves the machine.

Usage:
    GITHUB_TOKEN=<pat> python scripts/push_via_api.py
    GITHUB_TOKEN=<pat> python scripts/push_via_api.py --repo nbleo/factory_reporter
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- http
def _req(method: str, path: str, token: str, payload: dict | None = None):
    url = API + path if path.startswith("/") else path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "FactoryReporter-push/1.0")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:600]
    except Exception as e:                                    # noqa: BLE001
        return 0, str(e)


def api(method: str, path: str, token: str, payload: dict | None = None, tries: int = 4):
    """Call the API, retrying on transient 5xx / network errors."""
    status, body = 0, ""
    for attempt in range(tries):
        status, body = _req(method, path, token, payload)
        if status in (500, 502, 503, 504) or status == 0:
            wait = 2 * (attempt + 1)
            print(f"    retry {attempt + 1}/{tries} after {wait}s (status={status})")
            time.sleep(wait)
            continue
        return status, body
    return status, body


# --------------------------------------------------------------------------- local
def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                         check=True)
    return [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]


def read_bytes(rel: str) -> bytes:
    return (ROOT / rel).read_bytes()


def seed_root_commit(owner: str, name: str, branch: str, token: str, rel: str) -> int:
    """Create the first commit of an empty repository through the Contents API.

    `POST /git/blobs` answers 409 "Git Repository is empty" until the
    repository has at least one commit, so a brand-new repository has to be
    bootstrapped with a commit that already contains a real file. The seed
    file is one of the files being pushed anyway, so the tree merged on top
    of it overwrites the same path and leaves nothing behind.
    """
    raw = read_bytes(rel)
    payload = {
        "message": "Initialise repository",
        "content": base64.b64encode(raw).decode("ascii"),
        "branch": branch,
    }
    st, body = api("PUT", f"/repos/{owner}/{name}/contents/{rel}", token, payload)
    if st not in (200, 201):
        print(f"  seed FAIL: {st} {body}", file=sys.stderr)
        return 1
    print(f"  seed: {rel} -> first commit created")
    return 0


# --------------------------------------------------------------------------- push
def push(repo: str, branch: str, message: str, token: str, dry: bool = False) -> int:
    owner, name = repo.split("/", 1)

    files = tracked_files()
    print(f"tracked files: {len(files)}")
    if dry:
        for f in files:
            print("   ", f)
        return 0
    if not files:
        print("nothing tracked — run 'git add' first", file=sys.stderr)
        return 1

    # --- current head (may not exist yet on an empty repo) -------------------
    status, ref = api("GET", f"/repos/{owner}/{name}/git/ref/heads/{branch}", token)
    if status == 404 or status == 409:
        # An empty repository has no ref yet. Blob creation would fail with 409,
        # so make a root commit from one of our own files first, then re-read.
        print("head: (empty repository — seeding a root commit)")
        seed = next((f for f in files if f.endswith(".md")), files[0])
        if seed_root_commit(owner, name, branch, token, seed) != 0:
            return 1
        status, ref = api("GET", f"/repos/{owner}/{name}/git/ref/heads/{branch}", token)

    if status == 200:
        head_sha = ref["object"]["sha"]
        _, head_commit = api("GET", f"/repos/{owner}/{name}/git/commits/{head_sha}", token)
        base_tree = head_commit.get("tree", {}).get("sha")
        parents = [head_sha]
        print(f"head: {head_sha[:8]}  base_tree: {(base_tree or '-')[:8]}")
    else:
        print(f"cannot read ref: {status} {ref}", file=sys.stderr)
        return 1

    # --- blobs ---------------------------------------------------------------
    tree = []
    for i, rel in enumerate(files, 1):
        raw = read_bytes(rel)
        payload = {"content": base64.b64encode(raw).decode("ascii"),
                   "encoding": "base64"}
        st, body = api("POST", f"/repos/{owner}/{name}/git/blobs", token, payload)
        if st not in (200, 201):
            print(f"  blob FAIL {rel}: {st} {body}", file=sys.stderr)
            return 1
        tree.append({"path": rel.replace("\\", "/"), "mode": "100644",
                     "type": "blob", "sha": body["sha"]})
        if i % 10 == 0 or i == len(files):
            print(f"  blobs {i}/{len(files)}")
        if i % 40 == 0:                       # be gentle with secondary rate limits
            time.sleep(1)

    # --- tree ----------------------------------------------------------------
    payload = {"tree": tree}
    if base_tree:
        payload["base_tree"] = base_tree
    st, body = api("POST", f"/repos/{owner}/{name}/git/trees", token, payload)
    if st == 403 and any(e["path"].startswith(".github/workflows/") for e in tree):
        # Fine-grained tokens need the separate "Workflows" permission to touch
        # .github/workflows/*. Fall back to everything else and use branch
        # deployment for Pages instead of a workflow.
        print("  note: token lacks the 'Workflows' permission - skipping "
              ".github/workflows/*", file=sys.stderr)
        tree = [e for e in tree if not e["path"].startswith(".github/workflows/")]
        payload = {"tree": tree}
        if base_tree:
            payload["base_tree"] = base_tree
        st, body = api("POST", f"/repos/{owner}/{name}/git/trees", token, payload)
    if st not in (200, 201):
        print(f"  tree FAIL: {st} {body}", file=sys.stderr)
        return 1
    tree_sha = body["sha"]
    print(f"tree: {tree_sha[:8]} ({len(tree)} entries)")

    # --- commit --------------------------------------------------------------
    st, body = api("POST", f"/repos/{owner}/{name}/git/commits", token,
                   {"message": message, "tree": tree_sha, "parents": parents})
    if st not in (200, 201):
        print(f"  commit FAIL: {st} {body}", file=sys.stderr)
        return 1
    commit_sha = body["sha"]
    print(f"commit: {commit_sha[:8]}")

    # --- update ref ----------------------------------------------------------
    if head_sha is None:
        st, body = api("POST", f"/repos/{owner}/{name}/git/refs", token,
                       {"ref": f"refs/heads/{branch}", "sha": commit_sha})
    else:
        st, body = api("PATCH", f"/repos/{owner}/{name}/git/refs/heads/{branch}", token,
                       {"sha": commit_sha, "force": False})
    if st not in (200, 201):
        print(f"  ref update FAIL: {st} {body}", file=sys.stderr)
        return 1

    print(f"\nOK  https://github.com/{owner}/{name}/tree/{branch}")
    return 0


def publish_pages(repo: str, branch: str, message: str, token: str, subdir: str = "app") -> int:
    """Publish a sub-directory (default `app/`) to its own branch, for Pages.

    GitHub Pages can serve a branch root directly, which avoids needing an
    Actions workflow - and therefore avoids needing the token's separate
    "Workflows" permission. The branch tree is rebuilt from scratch every
    time so deleted files disappear from the site instead of lingering.
    """
    owner, name = repo.split("/", 1)
    prefix = subdir.rstrip("/") + "/"
    files = [f for f in tracked_files() if f.startswith(prefix)]
    if not files:
        print(f"no tracked files under {prefix}", file=sys.stderr)
        return 1
    print(f"publishing {len(files)} files from {prefix} -> branch {branch}")

    tree = []
    for i, rel in enumerate(files, 1):
        raw = read_bytes(rel)
        st, body = api("POST", f"/repos/{owner}/{name}/git/blobs", token,
                       {"content": base64.b64encode(raw).decode("ascii"),
                        "encoding": "base64"})
        if st not in (200, 201):
            print(f"  blob FAIL {rel}: {st} {body}", file=sys.stderr)
            return 1
        tree.append({"path": rel[len(prefix):].replace("\\", "/"), "mode": "100644",
                     "type": "blob", "sha": body["sha"]})
        if i % 10 == 0 or i == len(files):
            print(f"  blobs {i}/{len(files)}")
        if i % 40 == 0:
            time.sleep(1)

    st, body = api("POST", f"/repos/{owner}/{name}/git/trees", token, {"tree": tree})
    if st not in (200, 201):
        print(f"  tree FAIL: {st} {body}", file=sys.stderr)
        return 1
    tree_sha = body["sha"]

    st, ref = api("GET", f"/repos/{owner}/{name}/git/ref/heads/{branch}", token)
    parents = [ref["object"]["sha"]] if st == 200 else []
    st, body = api("POST", f"/repos/{owner}/{name}/git/commits", token,
                   {"message": message, "tree": tree_sha, "parents": parents})
    if st not in (200, 201):
        print(f"  commit FAIL: {st} {body}", file=sys.stderr)
        return 1
    commit_sha = body["sha"]

    if parents:
        st, body = api("PATCH", f"/repos/{owner}/{name}/git/refs/heads/{branch}", token,
                       {"sha": commit_sha, "force": True})
    else:
        st, body = api("POST", f"/repos/{owner}/{name}/git/refs", token,
                       {"ref": f"refs/heads/{branch}", "sha": commit_sha})
    if st not in (200, 201):
        print(f"  ref update FAIL: {st} {body}", file=sys.stderr)
        return 1
    print(f"  branch {branch} -> {commit_sha[:8]}")
    return 0


def enable_pages(repo: str, branch: str, token: str) -> int:
    """Point Pages at `branch` (root), replacing any GitHub Actions build."""
    source = {"branch": branch, "path": "/"}
    st, cur = api("GET", f"/repos/{repo}/pages", token)
    if st == 200 and isinstance(cur, dict):
        if cur.get("source") == source:
            print(f"Pages     : already serving branch '{branch}' "
                  f"-> {cur.get('html_url')}")
            return 0
        st, body = api("PUT", f"/repos/{repo}/pages", token,
                       {"build_type": "legacy", "source": source})
        if st in (200, 204):
            print(f"Pages     : source switched to branch '{branch}'")
            return 0
        print(f"Pages     : could not switch automatically (HTTP {st} {body})")
    else:
        st, body = api("POST", f"/repos/{repo}/pages", token,
                       {"build_type": "legacy", "source": source})
        if st in (200, 201, 204):
            print(f"Pages     : enabled - serving branch '{branch}' at its root")
            return 0
        if st == 409:                              # exists but unreadable
            st, body = api("PUT", f"/repos/{repo}/pages", token,
                           {"build_type": "legacy", "source": source})
            if st in (200, 204):
                print(f"Pages     : source set to branch '{branch}'")
                return 0
        print(f"Pages     : could not be configured automatically (HTTP {st} {body})")
    print(f"            set it once at https://github.com/{repo}/settings/pages"
          f"  ->  Source: Deploy from a branch, branch '{branch}', folder '/ (root)'")
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="nbleo/factory_reporter")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--message", default="Update Factory Reporter")
    ap.add_argument("--dry", action="store_true", help="list files only, do not push")
    ap.add_argument("--pages", action="store_true",
                    help="also publish app/ to the gh-pages branch and point Pages at it")
    args = ap.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print("GITHUB_TOKEN is not set", file=sys.stderr)
        return 2
    rc = push(args.repo, args.branch, args.message, token, dry=args.dry)
    if rc != 0 or args.dry or not args.pages:
        return rc
    if publish_pages(args.repo, "gh-pages", args.message, token) != 0:
        return 1
    return enable_pages(args.repo, "gh-pages", token)


if __name__ == "__main__":
    raise SystemExit(main())
