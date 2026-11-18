/* Real-Chromium smoke test: boot, create a visit, custom chips, business card,
   checklist built from empty, template editing, summary comments, PDF. */
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
      visible: FRRules.visibleSections().length,
      visibleIds: FRRules.visibleSections().map((s) => s.id),
      numbering: FRRules.sections().filter((s) => !s.empty).map((s) => s.no).join(",")
    }));
    check("7 sections loaded", cl.sections === 7, String(cl.sections));
    check("checklist is empty by default", cl.items === 0, String(cl.items));
    check("empty sections are hidden", cl.visible === 4, cl.visibleIds.join(","));
    check("section numbers skip the hidden ones", cl.numbering === "1,2,3,4", cl.numbering);

    /* ------------------------------------------- fields removed / added */
    const fields = await page.evaluate(() => ({
      licence: FRRules.field("businessLicenseNo"),
      address: FRRules.field("addressMatchesLicense"),
      showroom: FRRules.field("showroomAreaSqm"),
      markets: !!(FRRules.field("mainMarkets") || {}).options,
      customers: (FRRules.field("mainCustomers") || {}).type,
      card: (FRRules.field("businessCardIds") || {}).type,
      marketsCustom: !!(FRRules.field("mainMarkets") || {}).allowCustom,
      productsCustom: !!(FRRules.field("mainProducts") || {}).allowCustom,
      processesCustom: !!(FRRules.field("inHouseProcesses") || {}).allowCustom
    }));
    check("business licence number is gone", fields.licence === null);
    check("licence-address comparison is gone", fields.address === null);
    check("sample room area is gone", fields.showroom === null);
    check("main markets added", fields.markets === true);
    check("main customers added", fields.customers === "textarea", fields.customers);
    check("business card slot added", fields.card === "photos", fields.card);
    check("own values allowed on products / markets / processes",
      fields.productsCustom && fields.marketsCustom && fields.processesCustom);

    const noScorebar = await page.evaluate(() => ({
      hasScore: !!document.getElementById("scoreVal"),
      hasProg: !!document.getElementById("progVal")
    }));
    check("no score control in the UI", noScorebar.hasScore === false && noScorebar.hasProg === true);

    /* ---------------------------------------------------------------- create */
    await page.click("#btnNew");
    await page.waitForFunction("window.FR.state().screen === 'edit'", { timeout: 8000 });
    check("new report opens editor", true);

    const emptyBar = await page.evaluate(() => ({
      tier: document.getElementById("progTier").textContent,
      meta: document.getElementById("progMeta").textContent
    }));
    check("progress bar explains the empty checklist",
      /items in the checklist/.test(emptyBar.tier) && /Settings/.test(emptyBar.meta),
      emptyBar.tier + " / " + emptyBar.meta);

    await page.type("#editFactory", "Suzhou Bathware Co., Ltd");
    await page.type('#formMount input[data-field="cityProvince"]', "Suzhou, Jiangsu");
    await page.type('#formMount input[data-field="contactName"]', "Mr. Chen");
    await page.type('#formMount textarea[data-field="mainCustomers"]', "IKEA (OEM), local distributors");
    await tap('#formMount [data-chip="shower_enclosure"]');
    await tap('#formMount [data-chip="tempering"]');

    /* --------------------------------------------- a value of your own */
    await tap('[data-chip-new="mainProducts"]');
    await page.waitForSelector('[data-chip-text="mainProducts"]', { visible: true });
    await page.type('[data-chip-text="mainProducts"]', "Bathroom mirrors");
    await page.click('[data-chip-save="mainProducts"]');
    await new Promise((r) => setTimeout(r, 250));

    const custom = await page.evaluate(() => ({
      list: window.FR.state().current.profile.mainProducts,
      chips: Array.from(document.querySelectorAll('[data-chips="mainProducts"] .chip'))
        .map((c) => c.textContent + ":" + c.getAttribute("aria-pressed")),
      entryHidden: document.querySelector('[data-chip-entry="mainProducts"]').hidden
    }));
    check("own value is stored on the visit",
      custom.list.indexOf("Bathroom mirrors") !== -1, JSON.stringify(custom.list));
    check("own value shows as a selected chip",
      custom.chips.indexOf("Bathroom mirrors:true") !== -1, custom.chips.join(" | "));
    check("the entry row closes after adding", custom.entryHidden === true);

    /* market chip through the same path, so both fields are covered */
    await tap('[data-chip="germany"]');
    await tap('#formMount [data-chip="cnc"]');

    /* ------------------------------------------------ business card photo */
    const card = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 1200; c.height = 700;
      const x = c.getContext("2d");
      x.fillStyle = "#f4f4f6"; x.fillRect(0, 0, 1200, 700);
      x.strokeStyle = "#1F1FAF"; x.lineWidth = 8; x.strokeRect(60, 60, 1080, 580);
      x.fillStyle = "#111"; x.font = "bold 44px sans-serif";
      x.fillText("SUZHOU BATHWARE CO., LTD", 110, 160);
      x.font = "30px sans-serif";
      x.fillText("Mr. Chen - Export Manager", 110, 250);
      x.fillText("+86 512 8888 6666", 110, 320);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      await FRForm.addPhotoFiles([new File([blob], "card.jpg", { type: "image/jpeg" })],
        { key: "businessCardIds" });
      await window.FR.saveNow();
      const rep = window.FR.state().current;
      return {
        ids: rep.profile.businessCardIds.length,
        kind: (rep.photos[0] || {}).kind,
        thumb: !!document.querySelector('.shot-thumb[src^="blob:"]'),
        cover: FRModel.coverId(rep)
      };
    });
    check("business card photo stored on the profile", card.ids === 1, String(card.ids));
    check("card photo carries its own category", card.kind === "business_card", card.kind);
    check("card thumbnail is shown in the form", card.thumb === true);
    check("a card never becomes the cover photo", card.cover === "", card.cover);

    await page.evaluate(() => window.FR.saveNow());
    const afterFill = await page.evaluate(() => {
      const c = window.FR.state().current;
      return {
        name: c.profile.factoryName,
        products: c.profile.mainProducts,
        markets: c.profile.mainMarkets,
        processes: c.facts.inHouseProcesses,
        customers: c.profile.mainCustomers,
        id: c.id,
        author: c.meta.author
      };
    });
    check("factory name saved", afterFill.name === "Suzhou Bathware Co., Ltd", afterFill.name);
    check("chip selection saved", afterFill.products.indexOf("shower_enclosure") !== -1);
    check("market chip saved", afterFill.markets.indexOf("germany") !== -1);
    check("process chip saved", afterFill.processes.indexOf("cnc") !== -1);
    check("customers text saved", /IKEA/.test(afterFill.customers), afterFill.customers);
    check("id became readable", /^2026111\d-suzhou-bathware/.test(afterFill.id), afterFill.id);
    check("author defaults to Leo", afterFill.author === "Leo", afterFill.author);

    /* ------------------------------------- build a checklist, then record it */
    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 300));
    const seeded = await page.evaluate(async () => {
      document.querySelector('[data-cl-add="facilities"]').click();
      await new Promise((r) => setTimeout(r, 300));
      document.querySelector('[data-cl-add="facilities"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const labels = document.querySelectorAll('#checklistEditor [data-cl-label]');
      const last = labels[labels.length - 1];
      last.value = "Sample room shows current models";
      last.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return {
        items: FRRules.sectionItems("facilities").length,
        numbering: FRRules.sectionItems("facilities").map((i) => i.no).join(","),
        label: FRRules.sectionItems("facilities")[1].label,
        hiddenHint: /stays hidden/.test(document.querySelector('[data-cl-sec="quality"]').textContent)
      };
    });
    check("items can be added from Settings", seeded.items === 2, String(seeded.items));
    check("item numbers derive from the list", seeded.numbering === "2.1,2.2", seeded.numbering);
    check("item wording is editable", /current models/.test(seeded.label), seeded.label);
    check("empty section explains it stays hidden", seeded.hiddenHint === true);

    const id = await page.evaluate(() => window.FR.state().current.id);
    await page.evaluate((rid) => window.FR.openReport(rid), id);
    await page.waitForFunction("window.FR.state().screen === 'edit'", { timeout: 8000 });
    const inForm = await page.evaluate(() => ({
      checks: document.querySelectorAll("#formMount [data-check]").length,
      no: (document.querySelector("#formMount .check-no") || {}).textContent,
      sections: Array.from(document.querySelectorAll("#formMount .sec")).map((s) => s.dataset.sec)
    }));
    check("new items appear in the form", inForm.checks === 2, String(inForm.checks));
    check("form numbers the first new item 2.1", inForm.no === "2.1", inForm.no);
    check("hidden sections stay out of the form",
      inForm.sections.join(",") === "profile,facilities,commercial,comments", inForm.sections.join(","));

    /* ------------------------------------------------------- record, no score */
    await page.evaluate(() => window.FR.setAll("ok"));
    const recorded = await page.evaluate(() => ({
      done: FRModel.recordedCount(window.FR.state().current),
      total: FRModel.totalItems(),
      prog: document.getElementById("progVal").textContent,
      left: document.getElementById("progMeta").textContent,
      evaluation: "evaluation" in window.FR.state().current
    }));
    check("all items recorded", recorded.done === 2 && recorded.total === 2, recorded.done + "/" + recorded.total);
    check("progress text follows records", recorded.prog === "2" && /All items/.test(recorded.left),
      recorded.prog + " " + recorded.left);
    check("no evaluation object is produced", recorded.evaluation === false);

    await page.evaluate(() => {
      const rep = window.FR.state().current;
      const first = FRRules.sectionItems("facilities")[0].id;
      FRModel.answer(rep, first).state = "issue";
      FRModel.answer(rep, first).note = "Only three models on display, none of them the quoted one.";
      FRForm.refreshProgress();
    });
    const issueState = await page.evaluate(() => ({
      done: FRModel.recordedCount(window.FR.state().current)
    }));
    check("issue is a record, not a weighted score", issueState.done === 2);
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
      const shot = rep.photos.filter((p) => p.kind === "workshop")[0];
      return { photos: rep.photos.length, w: shot.w, h: shot.h };
    });
    check("photo stored and compressed", photo.photos === 2, String(photo.photos));
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
    check("cover falls back to the plant photo", cover0.img === true && cover0.stars === 2,
      String(cover0.stars));
    check("cover shows the photo category", /Workshop/.test(cover0.kind), cover0.kind);
    check("photo categories come from the template", cover0.kinds === 8, String(cover0.kinds));

    await tap('.photo-cell [data-set-cover]');
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
      el.value = "Clean plant, good glass line. Business card collected; EN 14428 still missing.";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return window.FR.saveNow();
    });
    const summary = await page.evaluate(() => window.FR.state().current.conclusion.comments);
    check("summary saved on the visit", /EN 14428 still missing/.test(summary), summary);

    const pdf = await page.evaluate(() => window.FR.buildPDF());
    fs.writeFileSync(path.join(OUT, "sample.pdf"), Buffer.from(pdf.base64, "base64"));

    const txt = Buffer.from(pdf.base64, "base64").toString("latin1");
    check("pdf header", txt.slice(0, 8) === "%PDF-1.4", txt.slice(0, 8));
    check("A4 media box", txt.indexOf("/MediaBox [0 0 595.28 841.89]") !== -1);
    check("Helvetica embedded as standard font", txt.indexOf("/BaseFont /Helvetica") !== -1);
    check("photos use DCTDecode", txt.indexOf("/DCTDecode") !== -1);
    check("text is vector (Tj operators)", (txt.match(/ Tj ET/g) || []).length > 40,
      String((txt.match(/ Tj ET/g) || []).length));
    check("no assessment score in the PDF", txt.indexOf("ASSESSMENT") === -1 && txt.indexOf("/ 100") === -1);
    check("no questions appendix", txt.indexOf("Questions and answers") === -1);
    check("summary printed in the PDF", txt.indexOf("Summary and comments") !== -1);
    check("summary text carried into the PDF", txt.indexOf("EN 14428 still missing") !== -1);
    check("business card printed in the profile", txt.indexOf("Contact business card") !== -1);
    check("own product value printed", txt.indexOf("Bathroom mirrors") !== -1);
    check("main customers printed", txt.indexOf("IKEA") !== -1);
    check("removed licence fields stay out of the PDF",
      txt.indexOf("Business licence") === -1 && txt.indexOf("matches licence") === -1);
    check("checklist section printed", txt.indexOf("Finding") !== -1);
    check("cover says prepared by Leo", txt.indexOf("Prepared by Leo") !== -1);
    check("page count reported", pdf.pages >= 3, String(pdf.pages));

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

    /* ------------------------------------------------------ template editing */
    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 300));
    const setAuthor = await page.evaluate(() => document.getElementById("setAuthor").value);
    check("settings shows author", setAuthor === "Leo", setAuthor);

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

      const secInput = document.querySelector('#templateEditor [data-tpl-section="facilities"]');
      secInput.value = "Plant and capacity";
      secInput.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));

      return {
        opt: FRRules.field("mainProducts").options[0][1],
        count: FRRules.field("mainProducts").options.length,
        fieldLabel: FRRules.field("employees").label,
        stateLabel: FRRules.states()[0].label,
        sectionTitle: FRRules.section("facilities").title,
        customized: FRRules.customizedTemplate()
      };
    });
    check("option label is editable", tpl1.opt === "Shower cabin", tpl1.opt);
    check("option can be added", tpl1.count === 10, String(tpl1.count));
    check("field label is editable", tpl1.fieldLabel === "Headcount", tpl1.fieldLabel);
    check("record state label is editable", tpl1.stateLabel === "Good", tpl1.stateLabel);
    check("section title is editable", tpl1.sectionTitle === "Plant and capacity", tpl1.sectionTitle);
    check("template override is stored", tpl1.customized === true);

    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForFunction("window.FR && window.FR.ready === true", { timeout: 15000 });
    const tpl2 = await page.evaluate(() => ({
      opt: FRRules.field("mainProducts").options[0][1],
      fieldLabel: FRRules.field("employees").label,
      items: FRRules.sectionItems("facilities").length
    }));
    check("template survives reload", tpl2.opt === "Shower cabin" && tpl2.fieldLabel === "Headcount",
      tpl2.opt + " / " + tpl2.fieldLabel);
    check("checklist survives reload", tpl2.items === 2, String(tpl2.items));

    await page.evaluate(() => window.FR.openReport(document.querySelector("#reportList .list-item").dataset.id));
    await page.waitForFunction("window.FR.state().screen === 'edit'", { timeout: 8000 });
    const formLabels = await page.evaluate(() => ({
      chip: (document.querySelector('#formMount [data-chip="shower_enclosure"]') || {}).textContent,
      field: (document.querySelector('#formMount [data-field="employees"]').closest(".field").querySelector("span") || {}).textContent,
      state: (document.querySelector('#formMount [data-check-state]') || {}).textContent,
      customKept: (document.querySelector('#formMount [data-chip="Bathroom mirrors"]') || {}).getAttribute
        ? document.querySelector('#formMount [data-chip="Bathroom mirrors"]').getAttribute("aria-pressed")
        : null
    }));
    check("form uses the edited option", formLabels.chip === "Shower cabin", formLabels.chip);
    check("form uses the edited field label", /Headcount/.test(formLabels.field), formLabels.field);
    check("form uses the edited state label", formLabels.state === "Good", formLabels.state);
    check("own product value still selected after reload", formLabels.customKept === "true",
      String(formLabels.customKept));

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
      sectionTitle: FRRules.section("facilities").title
    }));
    check("template reset restores defaults",
      tpl3.opt === "Shower enclosure" && /Employees/.test(tpl3.fieldLabel) &&
      tpl3.stateLabel === "OK" && tpl3.sectionTitle === "Scale and facilities",
      tpl3.opt + " / " + tpl3.fieldLabel + " / " + tpl3.stateLabel + " / " + tpl3.sectionTitle);

    /* -------------------------------------------------------- home comments */
    await page.evaluate(() => window.FR.show("home"));
    await new Promise((r) => setTimeout(r, 400));
    const homeComment = await page.evaluate(() => document.getElementById("commentText").value);
    check("home shows the latest summary", /EN 14428 still missing/.test(homeComment), homeComment);

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
    check("list badge shows records", list.badge === "2/2", list.badge);
    check("home list shows the cover photo", /^blob:/.test(list.thumb), list.thumb);
    check("comment persists after reload", /Follow-up: request/.test(list.comment), list.comment);

    await page.screenshot({ path: path.join(OUT, "home.png"), fullPage: true });
    await page.click("#reportList .list-item");
    await new Promise((r) => setTimeout(r, 500));
    check("list opens the report", await page.evaluate(() => window.FR.state().screen === "edit"));
    await page.screenshot({ path: path.join(OUT, "edit.png"), fullPage: false });

    /* ------------------------------------------------- clear the checklist */
    await page.evaluate(() => window.FR.show("settings"));
    await new Promise((r) => setTimeout(r, 250));
    await page.click("#btnResetChecklist");
    await page.waitForFunction("!document.getElementById('modal').hidden");
    await page.click("#modalOk");
    await new Promise((r) => setTimeout(r, 400));
    const cleared = await page.evaluate(() => ({
      items: FRRules.itemIds().length,
      visible: FRRules.visibleSections().length
    }));
    check("clearing empties the checklist", cleared.items === 0, String(cleared.items));
    check("sections hide again after clearing", cleared.visible === 4, String(cleared.visible));

    check("no page errors", errors.length === 0, errors.join(" | "));
  } catch (e) {
    fail++;
    console.log("  FAIL exception: " + e.message + "\n" + (e.stack || ""));
  } finally {
    await browser.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
