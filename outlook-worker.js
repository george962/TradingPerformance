/* Builds the outlook model off the main thread so the page stays smooth. */
importScripts('outlook-model.js');
self.onmessage = function (e) {
  try {
    var d = e.data || {};
    var res = self.OutlookModel.build(d.series || {});
    res.globalCheck = self.OutlookModel.globalCheck(d.markets || {});
    res.downloadErrors = d.errors || {};
    res.dataFetchedAt = d.fetchedAt || null;
    self.postMessage({ ok: true, result: res });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
