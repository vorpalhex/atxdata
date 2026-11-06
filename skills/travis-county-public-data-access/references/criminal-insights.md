# Criminal Insights — Supervised Dashboard and Official Report Fallback

Browser prerequisite: agent-browser is an optional external CLI, not a private skill supplied by this repository. Follow [installation, private-session setup and the smoke test](browser-setup.md) before using its commands. Install with `brew install agent-browser` on macOS or `npm install -g agent-browser`, then run `agent-browser install` and `agent-browser skills get core` through the terminal tool. An ordinary human browser or another approved control tool can perform equivalent UI steps; preserve this procedure's scope and stopping rules.

## Scope and source distinction

[Criminal Insights](https://courtsdata.traviscountytx.gov/CriminalInsights/Dataset) is a public aggregate court-activity dashboard, not individual case files. Its Welcome introduction explains that the district and county clerks submit monthly felony/misdemeanor statistics to the Texas Office of Court Administration (OCA). The dashboard also contains other counties; an unfiltered view is not Travis-only.

Normal browser operation is supported. An earlier Qlik CSV export returned Access denied with export permissions disabled. Do not retry it through alternate endpoints, replay access material, alter permissions or extract hidden model data as a substitute for the denied export. Browser-managed concurrency is permitted and is not an access blocker.

The [official OCA Court Activity Database page](https://www.txcourts.gov/media/judicial-data-and-reports) links to a separate [public report builder](https://card.txcourts.gov/ReportSelection.aspx). It explicitly offers PDF, Excel and Word output. This is an official alternative reporting source for related monthly statistics, NOT an enabled Qlik export or proof of identical dataset versions/transforms. PDF acquisition was verified; Excel and Word were not tested.

## Dashboard procedure

Use the general agent-browser skill through the terminal tool, a unique named local session and explicit reviewed config. Keep raw captures and report bytes in a private destination outside the repository. Do not attach personal browser profiles or copy cookies without approval.

1. Open Dataset and wait for visible County, year, Month and Division controls; the initial shell can render before Qlik finishes loading. Use snapshots and actual current refs.
2. Select TRAVIS and confirm the selection. Choose the required year, month and division, confirming each. Select the intended calendar/state/county fiscal-year basis explicitly. Read the resulting controls after rendering settles: a click/confirmation alone does not prove the chart has updated.
3. Verify selected values in the normal DOM: selected rows expose `role="row"` and `aria-selected="true"`. The bounded example selected exactly TRAVIS, 2025, JAN and COUNTY with CALENDAR YEAR active. Green controls and the rendered chart corroborate selection; horizontally clipped month values may require scrolling.
4. Read the chosen public chart/tab and preserve selection state, chart labels, observation time, warnings and a private screenshot/text capture. Dashboard screenshots are observations, not original dataset exports. Negative/zero-value chart warnings mean a pie chart cannot establish the complete underlying population. Do not infer missing categories, unique people or a whole archive from visible percentages.
5. For original published report bytes, use the separate OCA route below. No new Qlik export attempt is needed.

## OCA report procedure — one county, one month

1. Follow the official OCA page's current Run Reports link. Select County-Level Courts, then Misdemeanor Activity Detail, and Continue. This report covers county-level misdemeanor activity; district/felony and other report types remain separate and untested.
2. Set From Year and To Year to 2025, and both months to January for the verified example. Select Travis, Court All, and Export to Acrobat. Some controls trigger full ASP.NET postbacks. Wait for the page's load and the expected control to return after each change, then reread every selected value. Initial year 2010 exposes only September–December: set the year before selecting January. Do not run the default all-county or multi-year report accidentally.
3. Preserve the report title and exact final visible criteria privately. Click Run Report ONCE. A new document/navigation is not necessarily a file download: the verified run rendered a source PDF with HTTP 200, application/pdf and a two-page browser viewer.
4. Prefer the viewer's Download control when it works. In the observed agent-browser session, both `download` around Run Report and around viewer Download timed out without producing a saved file; the report itself nevertheless loaded. Do not repeat report generation or claim those download commands succeeded. Inspect the already-open report and output directory first.
5. A cache-only read of the already delivered OCA PDF succeeded. From that report's own document context, use agent-browser `eval --stdin` through the terminal tool with the following expression. It never falls back to the network: a cache miss/non-200 response means stop and use an approved manual save, not change cache policy or replay a report endpoint. The size cap applies to local byte extraction AFTER the viewer loaded, not a pretransfer network ceiling.

```javascript
(async () => {
  const r = await fetch(location.href, {cache: 'only-if-cached', mode: 'same-origin'});
  if (!r.ok) return {ok: false, status: r.status};
  const b = await r.blob();
  if (b.size > 12582912) throw Error('cap');
  const a = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < a.length; i += 32768)
    s += String.fromCharCode(...a.subarray(i, i + 32768));
  return {ok: true, status: r.status, size: b.size, type: b.type, base64: btoa(s)};
})()
```

Capture stdout privately, parse the JSON response (unwrap a JSON string only if necessary), require ok=true/status=200/application/pdf/nonzero size, strictly decode base64 and require actual length equal to size and a `%PDF-` signature. Save exclusively to a fresh private filename (`O_CREAT|O_EXCL`, mode 0600 or equivalent); never overwrite an existing file/symlink. This reads the officially offered OCA report, not protected Qlik data. Do not publish opaque browser/session URLs, base64 bodies, raw source HTML or access material.

6. Validate the saved unchanged original using pdfinfo, qpdf and pdftotext through the terminal tool. Check report name, county, actual period and every physical page against page numbering. Inspect rendered pages when checking layout or ambiguous text. Record source identity, selection criteria, observation/report-run dates, bytes and SHA-256 separately. Browser Print/agent-browser pdf produces a derivative, not the source-delivered report.
7. Close only the owned task browser. Offline reuse verifies the retained hash and report identity without source calls; it does not establish freshness. A later run requires a new filename/time and renewed scope. No unattended retry, bulk history, client database or completeness protocol is implemented.

## Bounded verification — November 5, 2026

- Managed agent-browser 0.41.2 anonymously loaded the dashboard and confirmed TRAVIS, calendar 2025, JAN and COUNTY. The historical browser-concurrency objection is superseded. Native context-menu/hover inspection exposed no usable export/data table; this does not prove every chart lacks one.
- OCA's ordinary public report UI generated one County-Level Courts / Misdemeanor Case Activity Detail report for Travis, January 1–31, 2025, Court All. The source-delivered PDF was retained from the browser cache, not printed or reconstructed.
- Original: 83,831 bytes, PDF 1.7, two pages; SHA-256 `54757a4968a26e604649f7face6d7520bfe560a965e8ef587a316c08bbc041be`. pdfinfo, qpdf and readable pdftotext all exited 0. Both rendered pages were inspected; headers match county/period and footers say Page 1 of 2 and Page 2 of 2. Report run date is November 5, 2026, distinct from January 2025 activity.
- Page 1 totals: 1,382 new cases, 39 motions to revoke filed, 294 reactivated, 11 other added. Their sum is 1,726; shares round to 80.1%, 2.3%, 17.0%, 0.6%. The first three reconcile with the visible Added Type chart labels at the verified selection; the fourth lacked a visible percentage label. This narrow cross-check is not an all-chart or historical dataset equivalence claim. The dashboard warns that negative/zero values cannot be shown.
- Page 1 reports 1,161 cases disposed; page 2's age-of-disposed total is also 1,161. This is report-internal reconciliation, not an independent audit of reporting accuracy.

The deliverable is supervised dashboard use plus ONE verified official fallback report, not a complete Criminal Insights export, structured transaction/case collector, all-court census or complete history. Missing report submissions and publisher/version differences remain possible. No disabled export was retried or bypassed. No production client was added; Bun/SQLite, TDD, CRAP, duplication and mutation metrics are N/A, not passing measurements. Independent review and owner acceptance are separate from these acquisition observations.
