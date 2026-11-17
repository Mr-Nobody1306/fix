"use strict";
/* ServePoint secure backend — thin entry point. All logic lives in src/.
   Browsers can only ever download files from public/. The Groq key
   never leaves this process except inside the HTTPS call to Groq. */
const http = require("node:http");
const config = require("./src/config");
const { createRateLimiter } = require("./src/rateLimit");
const { serveStatic, sendJson, securityHeaders, configureHeaders } = require("./src/static");
const { handleChat } = require("./src/chat");
const { handleWebhook, handleBanks, handleRecipient, handleCompletion, handleBookingStatus, handlePaymentStatus } = require("./src/paystack");
const { handleAdminArtisans, handleAdminSuspension, handleAdminOverview } = require("./src/admin");
const {
  handlePublicServices, handleAdminUsers, handleAdminUserBlock, handleAdminUserDelete,
  handleAdminServices, handleAdminServiceCreate, handleAdminServiceStatus,
  handleAdminBookings, handleAdminBookingDelete
} = require("./src/admin-management");
const { handleBookingLocation } = require("./src/tracking");
configureHeaders(config);
const limiter = createRateLimiter({ windowMs: 60 * 1000, max: config.chatMaxPerMin });
const adminLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
const trackingLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });
function dispatchAdmin(handler, req, res) {
  const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
  if (adminLimiter.isLimited(ip)) return sendJson(res, 429, { error: "Too many admin requests. Try again shortly." });
  Promise.resolve(handler(req, res, config)).catch((err) => {
    console.error("[admin] unhandled:", err && err.message);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    else { try { res.end(); } catch (e2) {} }
  });
}
function dispatchTracking(req, res) {
  const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
  if (trackingLimiter.isLimited(ip)) return sendJson(res, 429, { error: "Too many location updates. Try again shortly." });
  Promise.resolve(handleBookingLocation(req, res, config)).catch((err) => {
    console.error("[booking location] unhandled:", err && err.message);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    else { try { res.end(); } catch (e2) {} }
  });
}
function onRequest(req, res) {
  const t0 = Date.now();
  res.on("finish", () => {
    console.log(new Date().toISOString(), req.method, (req.url || "").split("?")[0], res.statusCode, Date.now() - t0 + "ms");
  });
  let pathname = "/";
  try { pathname = new URL(req.url || "/", "http://x").pathname; } catch (e) {}
  // Optional HTTP -> HTTPS redirect. OFF by default: enable ONLY when TLS is
  // terminated in front of this server (host "force HTTPS" or a proxy that
  // sets X-Forwarded-Proto). Enabling it on a bare-http server would loop.
  if (config.forceHttps) {
    const proto = String((req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim().toLowerCase();
    if (proto !== "https") {
      const host = String((req.headers && req.headers.host) || "localhost").split(",")[0].trim() || "localhost";
      res.writeHead(301, Object.assign({ Location: "https://" + host + (req.url || "/") }, securityHeaders()));
      return res.end();
    }
  }
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, model: config.groqModel, aiConfigured: config.groqKey.length > 0 });
  }
  if (pathname === "/api/paystack/webhook") {
    Promise.resolve(handleWebhook(req, res, config)).catch((err) => {
      console.error("[paystack webhook] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
      else { try { res.end(); } catch (e2) {} }
    });
    return;
  }
  if (pathname === "/api/paystack/banks") {
    Promise.resolve(handleBanks(req, res, config)).catch((err) => {
      console.error("[payout banks] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }
  if (pathname === "/api/paystack/recipient") {
    Promise.resolve(handleRecipient(req, res, config)).catch((err) => {
      console.error("[payout recipient] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }
  if (pathname === "/api/bookings/complete") {
    Promise.resolve(handleCompletion(req, res, config)).catch((err) => {
      console.error("[booking completion] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }
  if (pathname === "/api/bookings/status") {
    Promise.resolve(handleBookingStatus(req, res, config)).catch((err) => {
      console.error("[booking status] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }
  if (pathname === "/api/bookings/payment-status") {
    Promise.resolve(handlePaymentStatus(req, res, config)).catch((err) => {
      console.error("[payment status] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
    });
    return;
  }
  if (pathname === "/api/bookings/location") {
    dispatchTracking(req, res);
    return;
  }
  if (pathname === "/api/admin/artisans") {
    dispatchAdmin(handleAdminArtisans, req, res);
    return;
  }
  if (pathname === "/api/admin/suspension") {
    dispatchAdmin(handleAdminSuspension, req, res);
    return;
  }
  if (pathname === "/api/admin/overview") {
    dispatchAdmin(handleAdminOverview, req, res);
    return;
  }
  if (pathname === "/api/services") {
    Promise.resolve(handlePublicServices(req, res, config)).catch((err) => {
      console.error("[service catalog] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Could not load the service catalog." });
    });
    return;
  }
  if (pathname === "/api/admin/users") {
    dispatchAdmin(handleAdminUsers, req, res);
    return;
  }
  if (pathname === "/api/admin/user-block") {
    dispatchAdmin(handleAdminUserBlock, req, res);
    return;
  }
  if (pathname === "/api/admin/user-delete") {
    dispatchAdmin(handleAdminUserDelete, req, res);
    return;
  }
  if (pathname === "/api/admin/services") {
    if (req.method === "GET") return dispatchAdmin(handleAdminServices, req, res);
    if (req.method === "POST") return dispatchAdmin(handleAdminServiceCreate, req, res);
    return sendJson(res, 405, { error: "Use GET or POST." });
  }
  if (pathname === "/api/admin/service-status") {
    dispatchAdmin(handleAdminServiceStatus, req, res);
    return;
  }
  if (pathname === "/api/admin/bookings") {
    dispatchAdmin(handleAdminBookings, req, res);
    return;
  }
  if (pathname === "/api/admin/booking-delete") {
    dispatchAdmin(handleAdminBookingDelete, req, res);
    return;
  }
  if (pathname === "/api/chat") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." });
    Promise.resolve(handleChat(req, res, { config, limiter })).catch((err) => {
      console.error("[chat] unhandled:", err && err.message);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error." });
      else { try { res.end(); } catch (e2) {} }
    });
    return;
  }
  if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown API." });
  if (req.method !== "GET") { res.writeHead(405, securityHeaders()); return res.end("Method not allowed"); }
  if (pathname === "/admin/") {
    res.writeHead(308, Object.assign({ Location: "/admin" }, securityHeaders()));
    return res.end();
  }
  const staticPath = pathname === "/admin" ? "/" : pathname;
  return serveStatic(req, res, config.publicDir, staticPath);
}
const server = http.createServer(onRequest);
server.listen(config.port, () => {
  console.log("ServePoint secure server on http://localhost:" + config.port);
  console.log("AI model: " + config.groqModel + " | Key: " + (config.groqKey ? "set" : "MISSING — /api/chat will 503 until .env has GROQ_API_KEY"));
});
