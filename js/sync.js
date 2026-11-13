/* Private-repository backup over the GitHub REST API.
   Token lives in IndexedDB only; the app refuses to write to a public repo. */
window.FRSync = (function () {
  "use strict";

  var CFG_KEY = "syncCfg";
  var API = "https://api.github.com";
  var TIMEOUT = 30000;
  var BATCH = 12;

  var cfg = { owner: "", repo: "", branch: "main", token: "", login: "" };
  var publicCodeRepos = [{ owner: "nbleo", repo: "factory_reporter" }];
  var onLog = function () {};
  var busy = false;

  function setLogger(fn) { onLog = fn || function () {}; }
  function log(msg) { onLog(msg); }

  function load() {
    return FRDB.kvGet(CFG_KEY, null).then(function (v) {
      if (v && typeof v === "object") {
        cfg.owner = v.owner || "";
        cfg.repo = v.repo || "";
        cfg.branch = v.branch || "main";
        cfg.token = v.token || "";
        cfg.login = v.login || "";
      }
      return cfg;
    });
  }

  function save() {
    return FRDB.kvSet(CFG_KEY, {
      owner: cfg.owner, repo: cfg.repo, branch: cfg.branch,
      token: cfg.token, login: cfg.login
    });
  }

  function set(partial) {
    Object.keys(partial || {}).forEach(function (k) {
      if (k in cfg) cfg[k] = partial[k];
    });
    return save();
  }

  function conf() { return cfg; }

  function isConfigured() {
    return !!(cfg.owner && cfg.repo && cfg.token);
  }

  /* ------------------------------------------------------------- token hygiene */
  function cleanToken(t) {
    return String(t || "")
      .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, "")
      .replace(/[\s\u00a0\u3000]+/g, "");
  }

  function badChar(s) {
    var t = String(s || ""), i, c;
    for (i = 0; i < t.length; i++) {
      c = t.charCodeAt(i);
      if (c > 126 || c < 32) return t.charAt(i);
    }
    return "";
  }

  function charName(ch) {
    if (!ch) return "";
    var c = ch.charCodeAt(0);
    return "U+" + ("0000" + c.toString(16).toUpperCase()).slice(-4);
  }

  function netError(e, timedOut) {
    if (timedOut) {
      return new Error("api.github.com did not answer within 30 s. Try another network, or run Diagnose network.");
    }
    if (!FRUtil.isOnline()) {
      return new Error("This device is offline. Records stay on the phone; back up once you have Wi-Fi.");
    }
    return new Error("Cannot reach api.github.com (" + ((e && e.message) || "network error") +
      "). Corporate proxies sometimes block GitHub - try a phone hotspot.");
  }

  /* -------------------------------------------------------------------- http */
  function api(method, path, body) {
    var bad = badChar(cfg.token);
    if (bad) {
      return Promise.reject(new Error(
        "The saved token contains an invisible or non-ASCII character " + charName(bad) +
        ". Clear the token field and paste the token again - retyping never helps."));
    }
    var badRepo = badChar(cfg.owner) || badChar(cfg.repo) || badChar(cfg.branch);
    if (badRepo) {
      return Promise.reject(new Error("Owner, repository or branch contains an invalid character " +
        charName(badRepo) + "."));
    }
    if (!cfg.token) {
      return Promise.reject(new Error("No token saved. Add a fine-grained token with Contents: Read and write."));
    }

    var headers = {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (body) headers["Content-Type"] = "application/json";

    var url = API + path;
    if (method === "GET") url += (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();

    var attempt = 0;
    function run() {
      var ctl = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, TIMEOUT);
      return fetch(url, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal
      }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) {
          return res.text().then(function (txt) {
            var extra = "";
            try { var j = JSON.parse(txt); if (j && j.message) extra = " - " + j.message; } catch (e) {}
            var err = new Error(res.status + " " + res.statusText + extra);
            err.status = res.status;
            throw err;
          });
        }
        if (res.status === 204) return null;
        return res.json();
      }).catch(function (e) {
        clearTimeout(timer);
        if (e && e.status) throw e;
        if (method === "GET" && !timedOut && attempt < 2) {
          attempt++;
          return new Promise(function (r) { setTimeout(r, 600 * attempt); }).then(run);
        }
        throw netError(e, timedOut);
      });
    }
    return run();
  }

  function repoBase() {
    return "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);
  }

  function encPath(p) {
    return "/contents/" + String(p).split("/").map(encodeURIComponent).join("/");
  }

  function b64utf8(s) {
    return FRUtil.bytesToB64(new TextEncoder().encode(s));
  }

  function utf8b64(b64) {
    var bytes = FRUtil.b64ToBytes(String(b64 || "").replace(/\n/g, ""));
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* ------------------------------------------------------------------- guard */
  function assertSafe() {
    var hit = publicCodeRepos.filter(function (c) {
      return c.owner.toLowerCase() === String(cfg.owner).toLowerCase() &&
        c.repo.toLowerCase() === String(cfg.repo).toLowerCase();
    })[0];
    if (hit) {
      return Promise.reject(new Error('"' + hit.owner + "/" + hit.repo +
        '" is the public app repository (Pages site) - code only. Point the data at a private repository.'));
    }
    return api("GET", repoBase()).then(function (r) {
      if (!r.private) {
        return Promise.reject(new Error('"' + r.full_name + '" is a public repository, upload refused. ' +
          "Visit records and photos must never go into a public repository."));
      }
      return r;
    });
  }

  function ensureIdentity() {
    if (cfg.login) return Promise.resolve(cfg.login);
    return api("GET", "/user").then(function (u) {
      cfg.login = u.login;
      return save().then(function () { return cfg.login; });
    });
  }

  function root() { return "users/" + cfg.login + "/reports"; }
  function indexPath() { return root() + "/index.json"; }
  function reportPath(id) { return root() + "/" + id + "/report.json"; }
  function photoPath(id, pid) { return root() + "/" + id + "/photos/" + pid + ".jpg"; }

  /* ---------------------------------------------------------------- remote fs */
  function remoteTree() {
    return api("GET", repoBase() + "/git/trees/" + encodeURIComponent(cfg.branch) + "?recursive=1")
      .then(function (r) {
        var set = {};
        (r.tree || []).forEach(function (t) { if (t.type === "blob") set[t.path] = true; });
        return set;
      })
      .catch(function (e) {
        if (e.status === 404 || e.status === 409) return {};
        throw e;
      });
  }

  function readJSONFile(path) {
    return api("GET", repoBase() + encPath(path) + "?ref=" + encodeURIComponent(cfg.branch))
      .then(function (r) {
        return JSON.parse(utf8b64(r.content));
      })
      .catch(function (e) {
        if (e.status === 404) return null;
        throw e;
      });
  }

  function readIndex() {
    return readJSONFile(indexPath()).then(function (v) {
      return v && Array.isArray(v.reports) ? v : { schema: 1, updatedAt: null, reports: [] };
    });
  }

  /* Upload one commit. Retries the whole tree/commit sequence on 422. */
  function commitFiles(files, message) {
    var attempt = 0;

    function once() {
      var refSha = null, baseTree = null;
      return api("GET", repoBase() + "/git/ref/heads/" + encodeURIComponent(cfg.branch))
        .then(function (ref) {
          refSha = ref.object.sha;
          return api("GET", repoBase() + "/git/commits/" + refSha);
        })
        .then(function (c) { baseTree = c.tree.sha; })
        .catch(function (e) {
          if (e.status === 404 || e.status === 409) return null;
          throw e;
        })
        .then(function () {
          var chain = Promise.resolve([]);
          var shas = [];
          files.forEach(function (f) {
            chain = chain.then(function () {
              return api("POST", repoBase() + "/git/blobs", {
                content: f.base64, encoding: "base64"
              }).then(function (b) { shas.push(b.sha); });
            });
          });
          return chain.then(function () { return shas; });
        })
        .then(function (shas) {
          var tree = files.map(function (f, i) {
            return { path: f.path, mode: "100644", type: "blob", sha: shas[i] };
          });
          var payload = { tree: tree };
          if (baseTree) payload.base_tree = baseTree;
          return api("POST", repoBase() + "/git/trees", payload);
        })
        .then(function (t) {
          return api("POST", repoBase() + "/git/commits", {
            message: message, tree: t.sha, parents: refSha ? [refSha] : []
          });
        })
        .then(function (c) {
          if (refSha) {
            return api("PATCH", repoBase() + "/git/refs/heads/" + encodeURIComponent(cfg.branch),
              { sha: c.sha, force: false });
          }
          return api("POST", repoBase() + "/git/refs", {
            ref: "refs/heads/" + cfg.branch, sha: c.sha
          });
        })
        .catch(function (e) {
          var msg = String((e && e.message) || "");
          if (e && e.status === 422 && attempt < 4) {
            attempt++;
            log("Branch moved, retry " + attempt + "/4");
            return new Promise(function (r) { setTimeout(r, 700 * attempt); }).then(once);
          }
          if (e && e.status === 422) {
            throw new Error("Could not advance the branch after 4 attempts - another device may be " +
              "pushing at the same time. Try again.");
          }
          throw e;
        });
    }
    return once();
  }

  /* --------------------------------------------------------------------- push */
  function stripReport(report) {
    var copy = JSON.parse(JSON.stringify(report));
    delete copy._blob;
    return copy;
  }

  function indexItem(report) {
    return {
      id: report.id,
      factoryName: report.profile.factoryName || "",
      visitDate: report.profile.visitDate || "",
      recorded: FRModel.recordedCount(report),
      itemCount: FRModel.totalItems(),
      photoCount: (report.photos || []).length,
      updatedAt: report.updatedAt,
      deletedAt: report.deletedAt || null
    };
  }

  function pushReport(report) {
    if (busy) return Promise.reject(new Error("A backup is already running."));
    busy = true;
    var started = Date.now();

    return assertSafe()
      .then(function () { return ensureIdentity(); })
      .then(function () { return remoteTree(); })
      .then(function (tree) {
        var clean = stripReport(report);
        var json = JSON.stringify(clean);
        if (json.length > 900000) {
          throw new Error("Report JSON is unusually large (" + json.length + " bytes). Reduce notes.");
        }
        log("Report " + report.id + " - " + report.photos.length + " photo(s)");
        return commitFiles([{ path: reportPath(report.id), base64: b64utf8(json) }],
          "Report " + report.id + " (" + (report.profile.factoryName || "visit") + ")")
          .then(function () { return tree; });
      })
      .then(function (tree) {
        var missing = (report.photos || []).filter(function (p) {
          return !tree[photoPath(report.id, p.id)];
        });
        if (!missing.length) {
          log("Photos already in the repository - skipped");
          return null;
        }
        log("Uploading " + missing.length + " new photo(s)");
        var batches = [];
        for (var i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));

        var chain = Promise.resolve();
        batches.forEach(function (batch, idx) {
          chain = chain.then(function () {
            log("Photo batch " + (idx + 1) + "/" + batches.length + " (" + batch.length + " photos)");
            var files = [];
            var loadChain = Promise.resolve();
            batch.forEach(function (meta) {
              loadChain = loadChain.then(function () {
                return FRDB.get("photos", meta.id).then(function (row) {
                  if (!row || !row.blob) return null;
                  return row.blob.arrayBuffer().then(function (buf) {
                    files.push({
                      path: photoPath(report.id, meta.id),
                      base64: FRUtil.bytesToB64(new Uint8Array(buf))
                    });
                  });
                });
              });
            });
            return loadChain.then(function () {
              if (!files.length) return null;
              return commitFiles(files, "Photos for " + report.id + " (" + (idx + 1) + "/" + batches.length + ")");
            });
          });
        });
        return chain;
      })
      .then(function () { return readIndex(); })
      .then(function (index) {
        var item = indexItem(report);
        var found = false;
        index.reports = index.reports.map(function (r) {
          if (r.id === item.id) { found = true; return item; }
          return r;
        });
        if (!found) index.reports.push(item);
        index.updatedAt = FRUtil.now();
        return commitFiles([{ path: indexPath(), base64: b64utf8(JSON.stringify(index)) }],
          "Index update - " + item.factoryName);
      })
      .then(function () {
        report.pushedAt = FRUtil.now();
        report.idLocked = true;
        return FRDB.put("reports", report);
      })
      .then(function () {
        log("Backup finished in " + Math.round((Date.now() - started) / 1000) + " s");
        busy = false;
        return { ok: true };
      })
      .catch(function (e) {
        busy = false;
        log("Backup failed: " + e.message);
        throw e;
      });
  }

  /* --------------------------------------------------------------------- pull */
  function downloadPhoto(path) {
    return api("GET", repoBase() + encPath(path) + "?ref=" + encodeURIComponent(cfg.branch))
      .then(function (r) {
        var bytes = FRUtil.b64ToBytes(String(r.content || "").replace(/\n/g, ""));
        return new Blob([bytes], { type: "image/jpeg" });
      });
  }

  function pullReport(id) {
    return readJSONFile(reportPath(id)).then(function (raw) {
      if (!raw) return null;
      var rep = FRModel.normalize(raw);
      if (rep.deletedAt) {
        return FRDB.get("reports", rep.id).then(function (local) {
          if (local) {
            local.deletedAt = rep.deletedAt;
            return FRDB.put("reports", local);
          }
          return null;
        }).then(function () { return { skipped: true }; });
      }

      return FRDB.get("reports", rep.id).then(function (local) {
        if (local && local.updatedAt && rep.updatedAt && local.updatedAt > rep.updatedAt) {
          return { skipped: true, reason: "local is newer" };
        }
        var chain = Promise.resolve();
        var metas = rep.photos || [];
        metas.forEach(function (meta) {
          chain = chain.then(function () {
            return FRDB.get("photos", meta.id).then(function (existing) {
              if (existing && existing.blob) return null;
              return downloadPhoto(photoPath(rep.id, meta.id)).then(function (blob) {
                return FRDB.put("photos", {
                  id: meta.id, reportId: rep.id, itemId: meta.itemId || null,
                  kind: meta.kind || "other", caption: meta.caption || "",
                  w: meta.w, h: meta.h, size: meta.size || blob.size,
                  thumbSize: 0, sha256: meta.sha256 || "", createdAt: meta.createdAt,
                  blob: blob, thumbBlob: null
                });
              });
            });
          });
        });
        return chain.then(function () {
          rep.idLocked = true;
          return FRDB.put("reports", rep).then(function () { return { report: rep }; });
        });
      });
    });
  }

  function pullAll(progress) {
    return assertSafe()
      .then(function () { return ensureIdentity(); })
      .then(function () { return readIndex(); })
      .then(function (index) {
        var list = (index.reports || []).filter(function (r) { return !r.deletedAt; });
        log("Remote reports: " + list.length);
        var chain = Promise.resolve(0);
        var done = 0;
        list.forEach(function (item) {
          chain = chain.then(function (n) {
            if (progress) progress(done, list.length, item.factoryName || item.id);
            return pullReport(item.id).then(function () {
              done++;
              return Promise.resolve(done);
            });
          });
        });
        return chain;
      })
      .then(function (n) {
        log("Pulled " + n + " report(s)");
        return { pulled: n };
      });
  }

  /* -------------------------------------------------------------------- test */
  function test() {
    return assertSafe()
      .then(function (r) { return api("GET", "/user").then(function (u) { return { repo: r, user: u }; }); })
      .then(function (res) {
        cfg.login = res.user.login;
        return save().then(function () {
          return {
            ok: true,
            login: res.user.login,
            repo: res.repo.full_name,
            private: !!res.repo.private,
            defaultBranch: res.repo.default_branch
          };
        });
      });
  }

  function diagnose() {
    var out = [];
    function note(s) { out.push(s); log(s); }

    return Promise.resolve()
      .then(function () {
        note("1. Network: " + (FRUtil.isOnline() ? "online" : "OFFLINE"));
        note("   Node: " + navigator.userAgent.replace(/\s+/g, " ").slice(0, 90));
        return api("GET", "/rate_limit").then(function () {
          note("   api.github.com reachable");
        });
      })
      .then(function () {
        note("2. Token: length " + cfg.token.length +
          ", prefix " + (cfg.token ? cfg.token.slice(0, 11) : "-") +
          (badChar(cfg.token) ? "  BAD CHARACTER " + charName(badChar(cfg.token)) : "  ok"));
        return api("GET", "/user").then(function (u) {
          note("   authenticated as " + u.login);
          cfg.login = u.login;
        });
      })
      .then(function () {
        note("3. Repository: " + cfg.owner + "/" + cfg.repo);
        return api("GET", repoBase()).then(function (r) {
          note("   full name " + r.full_name + ", private=" + r.private +
            ", default branch " + r.default_branch);
          if (!r.private) note("   REFUSING: this repository is public");
        });
      })
      .then(function () {
        note("4. Contents: reading index.json");
        return readIndex().then(function (idx) {
          note("   index has " + idx.reports.length + " report(s)");
        });
      })
      .then(function () {
        return save().then(function () {
          note("Done.");
          return out.join("\n");
        });
      })
      .catch(function (e) {
        note("FAILED: " + e.message);
        return out.join("\n");
      });
  }

  return {
    load: load, save: save, set: set, conf: conf, isConfigured: isConfigured,
    setLogger: setLogger, cleanToken: cleanToken,
    test: test, pushReport: pushReport, pullAll: pullAll, pullReport: pullReport,
    diagnose: diagnose, indexPath: indexPath, reportPath: reportPath
  };
})();
