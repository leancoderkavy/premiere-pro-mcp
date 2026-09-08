(() => {
  const script = document.currentScript;
  const measurementId = script?.dataset.googleAnalyticsId;
  if (!measurementId || !/^G-[A-Z0-9]+$/i.test(measurementId)) return;
  const analyticsPermitted = () =>
    !["1", "yes"].includes(navigator.doNotTrack ?? "") && !navigator.globalPrivacyControl;
  if (!analyticsPermitted()) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const loadAnalytics = () => {
    // Recheck when the deferred callback runs; privacy state can change while idle.
    if (!analyticsPermitted()) return;
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(tag);
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { anonymize_ip: true, send_page_view: true });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadAnalytics, { timeout: 3_000 });
  } else {
    window.setTimeout(loadAnalytics, 1_500);
  }
})();
