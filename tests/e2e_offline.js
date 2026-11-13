/* Offline test: service worker install, offline reload, offline PDF, version parity. */
const path = require("path");
const fs = require("fs");
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  try {
    await page.goto(BASE, { waitUntil: "networkidle0", timeout: 20000 });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });

    const versions = await page.evaluate(async () => {
      const txt = await (await fetch("sw.js")).text();
      const m = txt.match(/factory-reporter-v([\w.]+)/);
      return { app: FRModel.APP_VERSION, cache: m ? m[1] : null, rules: FRRules.data().version };
    });
    check("cache suffix matches app version", versions.cache === versions.app,
      versions.cache + " vs " + versions.app);
    check("rules version published", !!versions.rules, versions.rules);

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });

    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    check("service worker controls the page", controlled);

    await page.click("#btnNew");
    await page.waitForFunction("window.FR.state().screen === 'edit'");
    await page.type("#editFactory", "Offline Factory");
    await page.evaluate(async () => {
      window.FR.setAll("ok");
      await window.FR.saveNow();
    });

    /* go offline and reload: the shell must come from the cache */
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    check("app boots offline", true);

    const offlineState = await page.evaluate(async () => {
      const list = document.querySelectorAll("#reportList .list-item").length;
      let reached = true;
      try {
        await fetch("https://api.github.com/rate_limit", { cache: "no-store" });
      } catch (e) { reached = false; }
      return { list: list, reached: reached };
    });
    check("report list available offline", offlineState.list >= 1, String(offlineState.list));
    check("remote calls fail while offline", offlineState.reached === false);

    const offlinePdf = await page.evaluate(async () => {
      const id = document.querySelector("#reportList .list-item").dataset.id;
      await window.FR.openReport(id);
      const res = await window.FR.buildPDF();
      return { size: res.size, pages: res.pages };
    });
    check("PDF builds offline", offlinePdf.size > 2000, String(offlinePdf.size));
    check("offline PDF has pages", offlinePdf.pages >= 3, String(offlinePdf.pages));

    await page.screenshot({ path: path.join(OUT, "offline.png") });
    await page.setOfflineMode(false);

    check("no page errors", errors.length === 0, errors.join(" | "));
  } catch (e) {
    fail++;
    console.log("  FAIL exception: " + e.message);
  } finally {
    await browser.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
