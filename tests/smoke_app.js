/* Real-Chromium smoke test: boot, create a visit, record items, edit the
   checklist, summary comments, PDF, persistence. */
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
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  /* Tap after centring the element: the sticky bottom bar covers the lower
     part of the viewport, which would otherwise swallow clicks. */
  async function tap(sel) {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.scrollIntoView({ block: "center" });
    }, sel);
    await new Promise((r) => setTimeout(r, 120));
    await page.click(sel);
  }

  try {
    await page.goto(BASE, { waitUntil: "networkidle0", timeout: 20000 });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    check("app boots", true);

    const cl = await page.evaluate(() => ({
      sections: FRRules.sections().length,
      items: FRRules.itemIds().length,
      first: FRRules.item("sampleRoom").no
    }));
    check("7 sections loaded", cl.sections === 7, String(cl.sections));
    check("25 default items loaded", cl.items === 25, String(cl.items));
    check("item numbering is derived", cl.first === "2.1", cl.first);

    const noScorebar = await page.evaluate(() => ({
      hasScore: !!document.getElementById("scoreVal"),
      hasProg: !!document.getElementById("progVal")
    }));
    check("no score control in the UI", noScorebar.hasScore === false && noScorebar.hasProg === true);

    /* ---------------------------------------------------------------- create */
    await page.click("#btnNew");
    await page.waitForFunction("window.FR.state().screen === 'edit'", { timeout: 8000 });
    check("new report opens editor", true);

    await page.type("#editFactory", "Suzhou Bathware Co., Ltd");
    await page.type('#formMount input[data-field="cityProvince"]', "Suzhou, Jiangsu");
    await page.type('#formMount input[data-field="contactName"]', "Mr. Chen");
    await page.type('#formMount input[data-field="employees"]', "120");
    await tap('#formMount [data-chip="shower_enclosure"]');
    await tap('#formMount [data-chip="tempering"]');

    await page.evaluate(() => window.FR.saveNow());
    const afterFill = await page.evaluate(() => {
      const c = window.FR.state().current;
      return {
        name: c.profile.factoryName,
        products: c.profile.mainProducts,
        employees: c.facts.employees,
        id: c.id,
        author: c.meta.author
      };
    });
    check("factory name saved", afterFill.name === "Suzhou Bathware Co., Ltd", afterFill.name);
    check("chip selection saved", afterFill.products.indexOf("shower_enclosure") !== -1);
    check("number field parsed", afterFill.employees === 120, String(afterFill.employees));
    check("id became readable", /^20261113-suzhou-bathware/.test(afterFill.id), afterFill.id);
    check("author defaults to Leo", afterFill.author === "Leo", afterFill.author);

    /* ------------------------------------------------------- record, no score */
    await page.evaluate(() => window.FR.setAll("ok"));
    const recorded = await page.evaluate(() => ({
      done: FRModel.recordedCount(window.FR.state().current),
      total: FRModel.totalItems(),
      prog: document.getElementById("progVal").textContent,
      left: document.getElementById("progMeta").textContent,
      evaluation: "evaluation" in window.FR.state().current
    }));
    check("all items recorded", recorded.done === 25 && recorded.total === 25, recorded.done + "/" + recorded.total);
    check("progress text follows records", recorded.prog === "25" && /All items/.test(recorded.left),
      recorded.prog + " " + recorded.left);
    check("no evaluation object is produced", recorded.evaluation === false);

    await page.evaluate(() => {
      const rep = window.FR.state().current;
      rep.answers.en14428.state = "issue";
      rep.answers.en14428.note = "No EN 14428 report for the offered model, only a summary sheet.";
      FRForm.refreshProgress();
    });
    const issueState = await page.evaluate(() => ({
      state: window.FR.state().current.answers.en14428.state,
      done: FRModel.recordedCount(window.FR.state().current)
    }));
    check("issue is a record, not a weighted score", issueState.state === "issue" && issueState.done === 25);

    await page.evaluate(() => window.FR.saveNow());

    /* ------------------------------------------------------------ photo + pdf */
    const photo = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 900; c.height = 600;
      const x = c.getContext("2d");
      x.fillStyle = "#1F1FAF"; x.fillRect(0, 0, 900, 600);
      x.fillStyle = "#ffffff"; x.font = "bold 56px sans-serif";
      x.fillText("WORKSHOP", 60, 300);
      x.font = "28px sans-serif"; x.fillText("Assembly line - test photo", 60, 360);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
      const file = new File([blob], "workshop.jpg", { type: "image/jpeg" });
      await window.FR.addPhoto(file, "workshop");
      const rep = window.FR.state().current;
      return { photos: rep.photos.length, w: rep.photos[0].w, h: rep.photos[0].h };
    });
    check("photo stored and compressed", photo.photos === 1, String(photo.photos));
    check("photo resized to 1600 max", photo.w === 900 && photo.h === 600, photo.w + "x" + photo.h);

    /* ------------------------------------------------------------ cover photo */
    await page.evaluate(() => window.FR.show("photos"));
    await new Promise((r) => setTimeout(r, 450));
    const cover0 = await page.evaluate(() => ({
      img: !document.getElementById("coverImg").hidden,
      kind: document.getElementById("coverKind").textContent,
      stars: document.querySelectorAll("[data-set-cover]").length,
      kinds: document.querySelectorAll("#photoKind option").length
    }));
    check("cover falls back to the first photo", cover0.img === true && cover0.stars === 1,
      String(cover0.stars));
    check("cover shows the photo category", /Workshop/.test(cover0.kind), cover0.kind);
    check("photo categories come from the template", cover0.kinds === 7, String(cover0.kinds));

    await tap("[data-set-cover]");
    await new Promise((r) => setTimeout(r, 350));
    const cover1 = await page.evaluate(() => ({
      id: window.FR.state().current.coverPhotoId,
      on: !!document.querySelector(".ph-cover.on")
    }));
    check("cover can be pinned to a photo", !!cover1.id && cover1.on === true, cover1.id);

    /* -------------------------------------------------- summary + comments field */
    await page.evaluate(() => {
      const el = document.querySelector('#formMount textarea[data-field="comments"]');
      el.scrollIntoView({ block: "center" });
      el.value = "Clean plant, good glass line. EN 14428 report still missing for the new 8 mm range.";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return window.FR.saveNow();
    });
    const summary = await page.evaluate(() => window.FR.state().current.conclusion.comments);
    check("summary saved on the visit", /EN 14428 report still missing/.test(summary), summary);

    const pdf = await page.evaluate(() => window.FR.buildPDF());
    fs.writeFileSync(path.join(OUT, "sample.pdf"), Buffer.from(pdf.base64, "base64"));

    const txt = Buffer.from(pdf.base64, "base64").toString("latin1");
    check("pdf header", txt.slice(0, 8) === "%PDF-1.4", txt.slice(0, 8));
    check("A4 media box", txt.indexOf("/MediaBox [0 0 595.28 841.89]") !== -1);
    check("Helvetica embedded as standard font", txt.indexOf("/BaseFont /Helvetica") !== -1);
    check("photo uses DCTDecode", txt.indexOf("/DCTDecode") !== -1);
    check("text is vector (Tj operators)", (txt.match(/ Tj ET/g) || []).length > 60,
      String((txt.match(/ Tj ET/g) || []).length));
    check("no assessment score in the PDF", txt.indexOf("ASSESSMENT") === -1 && txt.indexOf("/ 100") === -1);
    check("no questions appendix", txt.indexOf("Questions and answers") === -1);
    check("summary printed in the PDF", txt.indexOf("Summary and comments") !== -1);
    check("summary text carried into the PDF", txt.indexOf("EN 14428 report still missing") !== -1);
    check("cover says prepared by Leo", txt.indexOf("Prepared by Leo") !== -1);
    check("page count reported", pdf.pages >= 4, String(pdf.pages));

    const pagesInFile = (txt.match(/\/Type \/Page[^s]/g) || []).length;
    check("page objects match", pagesInFile === pdf.pages, pagesInFile + " vs " + pdf.pages);

    const xrefMatch = txt.match(/startxref\n(\d+)/);
    const xrefOff = xrefMatch ? Number(xrefMatch[1]) : -1;
    check("xref offset points at xref", xrefOff > 0 && txt.slice(xrefOff, xrefOff + 4) === "xref",
      String(xrefOff) + " -> " + txt.slice(xrefOff, xrefOff + 6));

    const entries = txt.slice(xrefOff).split("\n").slice(3, 3 + pdf.pages * 2);
    let offsetsOk = true;
    entries.forEach((line) => {
      const m = line.match(/^(\d{10}) 00000 n/);
      if (!m) return;
      const at = Number(m[1]);
      if (!/^\d+ 0 obj/.test(txt.slice(at, at + 12))) offsetsOk = false;
    });
    check("xref entries land on objects", offsetsOk);

    check("file name is readable", /^FactoryVisit_Suzhou-Bathware/.test(pdf.name), pdf.name);

    /* ------------------------------------------------------ checklist editing */
    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 300));
    const setAuthor = await page.evaluate(() => document.getElementById("setAuthor").value);
    check("settings shows author", setAuthor === "Leo", setAuthor);

    const edited = await page.evaluate(async () => {
      const input = document.querySelector('#checklistEditor [data-cl-label="sampleRoom"]');
      input.value = "Sample room - current models on display";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('[data-cl-add="facilities"]').click();
      await new Promise((r) => setTimeout(r, 300));
      return {
        items: FRRules.sectionItems("facilities").length,
        label: FRRules.item("sampleRoom").label,
        customized: FRRules.customized()
      };
    });
    check("item text is editable", edited.label === "Sample room - current models on display", edited.label);
    check("custom item can be added", edited.items === 5, String(edited.items));
    check("custom checklist is persisted", edited.customized === true);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    const survived = await page.evaluate(() => ({
      items: FRRules.sectionItems("facilities").length,
      label: FRRules.item("sampleRoom").label
    }));
    check("edits survive reload", survived.items === 5 && /current models/.test(survived.label),
      survived.items + " / " + survived.label);

    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 250));
    await page.click("#btnResetChecklist");
    await page.waitForFunction("!document.getElementById('modal').hidden");
    await page.click("#modalOk");
    await new Promise((r) => setTimeout(r, 400));
    const reset = await page.evaluate(() => ({
      items: FRRules.sectionItems("facilities").length,
      label: FRRules.item("sampleRoom").label
    }));
    check("reset restores defaults", reset.items === 4 && /representative/.test(reset.label),
      reset.items + " / " + reset.label);

    /* ---------------------------------------------------- template editing */
    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 300));
    const tpl1 = await page.evaluate(async () => {
      const group = document.querySelector('#templateEditor details[data-dtl="opt-mainProducts"]');
      group.open = true;
      const input = group.querySelector('[data-tpl-opt="mainProducts"]');
      input.value = "Shower cabin";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      document.querySelector('#templateEditor [data-tpl-opt-add="mainProducts"]').click();
      await new Promise((r) => setTimeout(r, 350));

      const labelInput = document.querySelector('#templateEditor [data-tpl-field="employees"]');
      labelInput.value = "Headcount";
      labelInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));

      const stateInput = document.querySelector('#templateEditor [data-tpl-state="ok"]');
      stateInput.value = "Good";
      stateInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));

      const secInput = document.querySelector('#templateEditor [data-tpl-section="quality"]');
      secInput.value = "Quality systems";
      secInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));

      return {
        opt: FRRules.field("mainProducts").options[0][1],
        count: FRRules.field("mainProducts").options.length,
        fieldLabel: FRRules.field("employees").label,
        stateLabel: FRRules.states()[0].label,
        sectionTitle: FRRules.section("quality").title,
        customized: FRRules.customizedTemplate()
      };
    });
    check("option label is editable", tpl1.opt === "Shower cabin", tpl1.opt);
    check("option can be added", tpl1.count === 10, String(tpl1.count));
    check("field label is editable", tpl1.fieldLabel === "Headcount", tpl1.fieldLabel);
    check("record state label is editable", tpl1.stateLabel === "Good", tpl1.stateLabel);
    check("section title is editable", tpl1.sectionTitle === "Quality systems", tpl1.sectionTitle);
    check("template override is stored", tpl1.customized === true);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    const tpl2 = await page.evaluate(() => ({
      opt: FRRules.field("mainProducts").options[0][1],
      fieldLabel: FRRules.field("employees").label
    }));
    check("template survives reload", tpl2.opt === "Shower cabin" && tpl2.fieldLabel === "Headcount",
      tpl2.opt + " / " + tpl2.fieldLabel);

    await page.evaluate(() => window.FR.openReport(document.querySelector("#reportList .list-item").dataset.id));
    await page.waitForFunction("window.FR.state().screen === 'edit'", { timeout: 8000 });
    const formLabels = await page.evaluate(() => ({
      chip: (document.querySelector('#formMount [data-chip="shower_enclosure"]') || {}).textContent,
      field: (document.querySelector('#formMount [data-field="employees"]').closest(".field").querySelector("span") || {}).textContent,
      state: (document.querySelector('#formMount [data-check-state="sampleRoom"]') || {}).textContent
    }));
    check("form uses the edited option", formLabels.chip === "Shower cabin", formLabels.chip);
    check("form uses the edited field label", /Headcount/.test(formLabels.field), formLabels.field);
    check("form uses the edited state label", formLabels.state === "Good", formLabels.state);

    const pdf2 = await page.evaluate(() => window.FR.buildPDF());
    const txt2 = Buffer.from(pdf2.base64, "base64").toString("latin1");
    check("PDF uses the edited option label", txt2.indexOf("Shower cabin") !== -1);
    check("PDF uses the edited record state", txt2.indexOf("Good") !== -1);

    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 300));
    await tap("#btnResetTemplate");
    await page.waitForFunction("!document.getElementById('modal').hidden");
    await page.click("#modalOk");
    await new Promise((r) => setTimeout(r, 450));
    const tpl3 = await page.evaluate(() => ({
      opt: FRRules.field("mainProducts").options[0][1],
      fieldLabel: FRRules.field("employees").label,
      stateLabel: FRRules.states()[0].label,
      sectionTitle: FRRules.section("quality").title
    }));
    check("template reset restores defaults",
      tpl3.opt === "Shower enclosure" && /Employees/.test(tpl3.fieldLabel) &&
      tpl3.stateLabel === "OK" && tpl3.sectionTitle === "Quality control",
      tpl3.opt + " / " + tpl3.fieldLabel + " / " + tpl3.stateLabel + " / " + tpl3.sectionTitle);

    /* -------------------------------------------------------- home comments */
    await page.evaluate(() => window.FR.show("home"));
    await new Promise((r) => setTimeout(r, 400));
    const homeComment = await page.evaluate(() => document.getElementById("commentText").value);
    check("home shows the latest summary", /EN 14428 report still missing/.test(homeComment), homeComment);

    await page.evaluate(() => {
      const box = document.getElementById("commentText");
      box.value = "Follow-up: request the EN 14428 report, then decide on a trial order.";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1200));
    const savedComment = await page.evaluate(async () => {
      const rows = await FRDB.all("reports");
      return rows[0].conclusion.comments;
    });
    check("home comment saves into the visit", /Follow-up: request/.test(savedComment), savedComment);

    /* ---------------------------------------------------------- persistence */
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    const list = await page.evaluate(() => ({
      count: document.querySelectorAll("#reportList .list-item").length,
      badge: (document.querySelector(".li-badge") || {}).textContent,
      comment: document.getElementById("commentText").value,
      thumb: (document.querySelector("#reportList [data-cover-img]") || {}).src || ""
    }));
    check("report persists after reload", list.count === 1, String(list.count));
    check("list badge shows records", list.badge === "25/25", list.badge);
    check("home list shows the cover photo", /^blob:/.test(list.thumb), list.thumb);
    check("comment persists after reload", /Follow-up: request/.test(list.comment), list.comment);

    await page.screenshot({ path: path.join(OUT, "home.png"), fullPage: true });
    await page.click("#reportList .list-item");
    await new Promise((r) => setTimeout(r, 500));
    check("list opens the report", await page.evaluate(() => window.FR.state().screen === "edit"));
    await page.screenshot({ path: path.join(OUT, "edit.png"), fullPage: false });

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
