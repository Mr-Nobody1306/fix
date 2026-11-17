"use strict";
const { sendJson } = require("./static");
const { currentUser, supabase, readBody } = require("./paystack");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(res, status, message) {
  return sendJson(res, status, { error: message });
}
function isConfigured(config) {
  return !!(config.adminEmail && EMAIL_PATTERN.test(config.adminEmail) &&
    config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey &&
    !/PASTE|YOUR_/i.test(config.supabaseUrl + config.supabaseAnonKey + config.supabaseServiceRoleKey));
}
async function authorizeAdmin(req, res, config) {
  if (!isConfigured(config)) {
    fail(res, 503, "The admin portal is not configured on the server.");
    return null;
  }
  const user = await currentUser(req, config);
  if (!user) {
    fail(res, 401, "Sign in with the authorized Google account.");
    return null;
  }
  const metadata = user.app_metadata || {};
  const providers = Array.isArray(metadata.providers) ? metadata.providers : [];
  const googleAccount = metadata.provider === "google" || providers.indexOf("google") !== -1;
  const verifiedEmail = !!(user.email_confirmed_at || user.confirmed_at || user.email_verified === true || googleAccount);
  const email = String(user.email || "").trim().toLowerCase();
  if (!googleAccount || !verifiedEmail || email !== config.adminEmail) {
    fail(res, 403, "This Google account is not authorized for the admin portal.");
    return null;
  }
  const profiles = await supabase(config,
    "profiles?select=is_blocked&id=eq." + encodeURIComponent(user.id) + "&limit=1");
  if (profiles && profiles[0] && profiles[0].is_blocked) {
    fail(res, 403, "This account is blocked from the admin portal.");
    return null;
  }
  return user;
}
async function handleAdminArtisans(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const user = await authorizeAdmin(req, res, config);
    if (!user) return;
    const artisans = await supabase(config,
      "profiles?select=id,name,trade,area,rating,jobs,is_suspended,suspension_reason,suspended_at,created_at" +
      "&role=eq.artisan&order=created_at.desc&limit=1000");
    return sendJson(res, 200, { artisans: artisans || [] });
  } catch (error) {
    console.error("[admin artisans]", error.message);
    return fail(res, 500, "Could not load artisan accounts.");
  }
}
async function handleAdminSuspension(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const user = await authorizeAdmin(req, res, config);
    if (!user) return;
    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); }
    catch (error) { return fail(res, error.statusCode || 400, "Invalid request body."); }
    const artisanId = String(body.artisanId || "");
    if (!UUID_PATTERN.test(artisanId) || typeof body.suspended !== "boolean") {
      return fail(res, 400, "Choose a valid artisan and suspension state.");
    }
    const reason = String(body.reason || "").trim();
    if (body.suspended && (reason.length < 5 || reason.length > 500)) {
      return fail(res, 400, "Enter a suspension reason between 5 and 500 characters.");
    }
    const result = await supabase(config, "rpc/admin_set_artisan_suspension", "POST", {
      p_admin_email: String(user.email).trim().toLowerCase(),
      p_artisan_id: artisanId,
      p_suspended: body.suspended,
      p_reason: body.suspended ? reason : null
    });
    if (!result || result.error === "artisan_not_found") return fail(res, 404, "Artisan account not found.");
    return sendJson(res, 200, { updated: !!result.changed, artisan: result });
  } catch (error) {
    console.error("[admin suspension]", error.message);
    return fail(res, 500, "Could not update the artisan account.");
  }
}
async function handleAdminOverview(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const user = await authorizeAdmin(req, res, config);
    if (!user) return;
    const overview = await supabase(config, "rpc/admin_portal_overview", "POST", {});
    return sendJson(res, 200, { overview });
  } catch (error) {
    console.error("[admin overview]", error.message);
    return fail(res, 500, "Could not load admin analytics and audit history.");
  }
}
module.exports = { authorizeAdmin, handleAdminArtisans, handleAdminSuspension, handleAdminOverview };
