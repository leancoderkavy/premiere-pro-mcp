(() => {
  const script = document.currentScript;
  const measurementId = script?.dataset.googleAnalyticsId;
  const posthogProjectToken = script?.dataset.posthogProjectToken;
  const posthogHost = script?.dataset.posthogHost || "https://us.i.posthog.com";
  const designPreview =
    window.location?.pathname?.startsWith("/design-preview") ||
    new URLSearchParams(window.location?.search ?? "").has("design");

  const analyticsPermitted = () =>
    !["1", "yes"].includes(navigator.doNotTrack ?? "") && !navigator.globalPrivacyControl;

  const allowedPosthogHost = (host) =>
    host === "https://us.i.posthog.com" || host === "https://eu.i.posthog.com";

  if (designPreview || !analyticsPermitted()) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  const loadGoogleAnalytics = () => {
    if (!measurementId || !/^G-[A-Z0-9]+$/i.test(measurementId)) return;
    if (!analyticsPermitted()) return;
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(tag);
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { anonymize_ip: true, send_page_view: true });
  };

  const flushPosthogQueue = (posthog) => {
    const pending = window.__premierePosthogQueue || [];
    window.__premierePosthogQueue = [];
    window.__premierePosthogReady = true;
    for (const item of pending) {
      if (item && typeof item.eventName === "string") {
        posthog.capture(item.eventName, item.properties || {});
      }
    }
  };

  const loadPosthog = () => {
    if (!posthogProjectToken || !/^phc_[A-Za-z0-9]+$/.test(posthogProjectToken)) return;
    if (!allowedPosthogHost(posthogHost)) return;
    if (!analyticsPermitted()) return;

    const tag = document.createElement("script");
    tag.async = true;
    tag.crossOrigin = "anonymous";
    tag.src = `${posthogHost.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/array.js`;
    tag.onload = () => {
      if (!window.posthog || typeof window.posthog.init !== "function") return;
      window.posthog.init(posthogProjectToken, {
        api_host: posthogHost,
        ui_host: posthogHost.includes("eu.i.posthog.com")
          ? "https://eu.posthog.com"
          : "https://us.posthog.com",
        defaults: "2026-05-30",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        advanced_disable_flags: true,
        ip: false,
        loaded: flushPosthogQueue,
      });
    };
    document.head.appendChild(tag);
  };

  const loadAnalytics = () => {
    loadGoogleAnalytics();
    loadPosthog();
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadAnalytics, { timeout: 3_000 });
  } else {
    window.setTimeout(loadAnalytics, 1_500);
  }
})();
