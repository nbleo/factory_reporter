/* Sync test with api.github.com mocked in the browser, plus the public-repo guard. */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const OUT = path.join(__dirname, "out");
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();

  const state = {
    refSha: null, index: null, commits: 0, blobs: 0, trees: 0, paths: new Set(),
    failPatch: false, baseTree: "basetree000000000000000000000000000000",
    lastCommitMessage: ""
  };

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("https://api.github.com")) return req.continue();

    const u = new URL(url);
    const p = u.pathname;
    const method = req.method();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,accept,x-github-api-version,x-requested-with",
      "content-type": "application/json"
    };

    function send(status, obj) {
      req.respond({ status, headers: cors, body: JSON.stringify(obj) });
    }

    if (method === "OPTIONS") {
      return req.respond({ status: 204, headers: cors, body: "" });
    }

    if (method === "GET" && p === "/user") return send(200, { login: "nbleo" });
    if (method === "GET" && p === "/rate_limit") return send(200, { resources: {} });
    if (method === "GET" && p === "/repos/nbleo/factory_reporter_data") {
      return send(200, {
        full_name: "nbleo/factory_reporter_data", private: true, default_branch: "main"
      });
    }
    if (method === "GET" && p === "/repos/nbleo/factory_reporter_data/git/trees/main") {
      return send(200, {
        tree: Array.from(state.paths).map((x) => ({ path: x, type: "blob" }))
      });
    }
    if (method === "GET" && p.endsWith("/git/ref/heads/main")) {
      if (!state.refSha) return send(404, { message: "Not Found" });
      return send(200, { object: { sha: state.refSha } });
    }
    if (method === "GET" && p.indexOf("/git/commits/") !== -1) {
      return send(200, { tree: { sha: state.baseTree } });
    }
    if (method === "POST" && p.endsWith("/git/blobs")) {
      state.blobs++;
      try {
        const body = JSON.parse(req.postData() || "{}");
        const text = Buffer.from(body.content || "", "base64").toString("utf8");
        if (text.indexOf('"reports"') !== -1) state.index = JSON.parse(text);
      } catch (e) { /* binary blob */ }
      return send(201, { sha: "blob" + state.blobs + "0000000000000000000000000000000" });
    }
    if (method === "POST" && p.endsWith("/git/trees")) {
      state.trees++;
      try {
        const body = JSON.parse(req.postData() || "{}");
        (body.tree || []).forEach((t) => state.paths.add(t.path));
      } catch (e) { /* ignore */ }
      return send(201, { sha: "tree" + state.trees + "0000000000000000000000000000000" });
    }
    if (method === "POST" && p.endsWith("/git/commits")) {
      state.commits++;
      try { state.lastCommitMessage = JSON.parse(req.postData() || "{}").message || ""; } catch (e) {}
      state.refSha = "commit" + state.commits + "000000000000000000000000000000";
      return send(201, { sha: state.refSha });
    }
    if (method === "PATCH" && p.indexOf("/git/refs/heads/main") !== -1) {
      if (state.failPatch) {
        state.failPatch = false;
        return send(422, { message: "Update is not a fast forward" });
      }
      return send(200, { object: { sha: state.refSha } });
    }
    if (method === "POST" && p.endsWith("/git/refs")) {
      return send(201, { ref: "refs/heads/main" });
    }
    if (method === "GET" && p.indexOf("/contents/") !== -1 && p.endsWith("index.json")) {
      if (!state.index) return send(404, { message: "Not Found" });
      return send(200, {
        content: Buffer.from(JSON.stringify(state.index)).toString("base64"),
        encoding: "base64"
      });
    }
    if (method === "GET" && p.indexOf("/contents/") !== -1) {
      return send(404, { message: "Not Found" });
    }

    console.log("    (mock) unhandled " + method + " " + p);
    return send(404, { message: "unhandled mock route" });
  });

  try {
    await page.goto(BASE, { waitUntil: "networkidle0", timeout: 20000 });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });

    /* create a report with one photo and one answer */
    await page.click("#btnNew");
    await page.waitForFunction("window.FR.state().screen === 'edit'");
    await page.type("#editFactory", "Test Factory");
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 400; c.height = 300;
      const x = c.getContext("2d");
      x.fillStyle = "#1F1FAF"; x.fillRect(0, 0, 400, 300);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
      await window.FR.addPhoto(new File([blob], "p.jpg", { type: "image/jpeg" }), "factory");
      window.FR.setAll("ok");
      await window.FR.saveNow();
    });

    /* 1. public code repo must be refused before any network write */
    const guard = await page.evaluate(async () => {
      await FRSync.set({
        owner: "nbleo", repo: "factory_reporter", branch: "main",
        token: "github_pat_test", login: "nbleo"
      });
      try {
        await FRSync.pushReport(window.FR.state().current);
        return "NO ERROR";
      } catch (e) { return e.message; }
    });
    check("public code repository refused", /public app repository/i.test(guard), guard);
    check("no commit attempted on the guard", state.commits === 0, String(state.commits));

    /* 2. first backup */
    const first = await page.evaluate(async () => {
      await FRSync.set({
        owner: "nbleo", repo: "factory_reporter_data", branch: "main",
        token: "github_pat_test", login: "nbleo"
      });
      await FRSync.pushReport(window.FR.state().current);
      return {
        pushed: !!window.FR.state().current.pushedAt,
        photos: window.FR.state().current.photos.length
      };
    });
    check("first backup reported success", first.pushed === true);
    check("report + photo + index commits", state.commits === 3, String(state.commits));
    check("three blobs on first backup", state.blobs === 3, String(state.blobs));  // report + jpg + index

    /* 3. second backup skips existing photos */
    const before = state.commits;
    await page.evaluate(async () => {
      const rep = window.FR.state().current;
      rep.profile.cityProvince = "Ningbo";
      rep.updatedAt = new Date().toISOString();
      await FRSync.pushReport(rep);
    });
    check("second backup skips the photo", state.commits === before + 2, String(state.commits - before));

    /* 4. 422 non-fast-forward is retried */
    state.failPatch = true;
    const beforeRetry = state.commits;
    const retry = await page.evaluate(async () => {
      const rep = window.FR.state().current;
      rep.profile.factoryName = "Test Factory 2";
      rep.updatedAt = new Date().toISOString();
      try { await FRSync.pushReport(rep); return "ok"; }
      catch (e) { return e.message; }
    });
    check("422 retry recovers", retry === "ok", retry);
    check("retry produced extra commits", state.commits > beforeRetry, String(state.commits - beforeRetry));

    /* 5. index on the remote lists the report */
    check("index.json written", !!state.index && state.index.reports.length === 1,
      JSON.stringify(state.index && state.index.reports.length));
    check("index carries the record count",
      state.index && state.index.reports[0].recorded === 25 && state.index.reports[0].itemCount === 25,
      String(state.index && state.index.reports[0].recorded));

    await page.screenshot({ path: path.join(OUT, "sync.png") });
  } catch (e) {
    fail++;
    console.log("  FAIL exception: " + e.message);
  } finally {
    await browser.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
