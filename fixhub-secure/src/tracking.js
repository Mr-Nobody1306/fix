"use strict";
const { sendJson } = require("./static");
const { currentActiveUser, supabase, readBody } = require("./paystack");

const BOOKING_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ACTIVE_STATUSES = "enroute,arrived,working";
function fail(res, status, message) {
  return sendJson(res, status, { error: message });
}
function configured(config) {
  return !!(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey &&
    !/PASTE|YOUR_/i.test(config.supabaseUrl + config.supabaseAnonKey + config.supabaseServiceRoleKey));
}
async function authenticatedUser(req, res, config) {
  if (!configured(config)) {
    fail(res, 503, "Live tracking is not configured on the server.");
    return null;
  }
  const user = await currentActiveUser(req, config);
  if (!user) {
    fail(res, 401, "Please sign in again.");
    return null;
  }
  return user;
}
async function findBooking(config, bookingId) {
  const rows = await supabase(config, "bookings?select=id,owner_id,customer_id,artisan_id,status&id=eq." +
    encodeURIComponent(bookingId) + "&limit=1");
  return rows && rows[0] || null;
}
async function handleBookingLocation(req, res, config) {
  if (req.method !== "GET" && req.method !== "POST") return fail(res, 405, "Use GET or POST.");
  try {
    const user = await authenticatedUser(req, res, config);
    if (!user) return;

    if (req.method === "GET") {
      const url = new URL(req.url || "/", "http://localhost");
      const bookingId = String(url.searchParams.get("bookingId") || "");
      if (!BOOKING_ID_PATTERN.test(bookingId)) return fail(res, 400, "Invalid booking.");
      const booking = await findBooking(config, bookingId);
      if (!booking || (booking.customer_id !== user.id && booking.owner_id !== user.id)) {
        return fail(res, 404, "Booking not found.");
      }
      if (ACTIVE_STATUSES.split(",").indexOf(booking.status) === -1 || !booking.artisan_id) {
        return sendJson(res, 200, { location: null, sharing: false });
      }
      const rows = await supabase(config, "booking_artisan_locations?select=latitude,longitude,accuracy_m,updated_at" +
        "&booking_id=eq." + encodeURIComponent(bookingId) + "&artisan_id=eq." +
        encodeURIComponent(booking.artisan_id) + "&limit=1");
      const location = rows && rows[0] || null;
      if (!location) return sendJson(res, 200, { location: null, sharing: false });
      const updatedAt = Date.parse(location.updated_at);
      if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 120000) {
        await supabase(config, "booking_artisan_locations?booking_id=eq." + encodeURIComponent(bookingId), "DELETE");
        return sendJson(res, 200, { location: null, sharing: false, expired: true });
      }
      return sendJson(res, 200, { location, sharing: true });
    }

    let body;
    try { body = JSON.parse((await readBody(req)).toString("utf8")); }
    catch (error) { return fail(res, error.statusCode || 400, "Invalid request body."); }
    const bookingId = String(body.bookingId || "");
    if (!BOOKING_ID_PATTERN.test(bookingId) || typeof body.sharing !== "boolean") {
      return fail(res, 400, "Choose a valid booking and sharing state.");
    }
    const booking = await findBooking(config, bookingId);
    if (!booking || booking.artisan_id !== user.id || ACTIVE_STATUSES.split(",").indexOf(booking.status) === -1) {
      return fail(res, 403, "Only the assigned artisan can share location during an active job.");
    }
    const applications = await supabase(config, "applications?select=booking_id&booking_id=eq." +
      encodeURIComponent(bookingId) + "&artisan_id=eq." + encodeURIComponent(user.id) +
      "&status=eq.accepted&limit=1");
    if (!applications || !applications.length) {
      return fail(res, 403, "Only the accepted artisan can share location.");
    }
    if (!body.sharing) {
      const result = await supabase(config, "rpc/set_servepoint_artisan_location", "POST", {
        p_booking_id: bookingId,
        p_artisan_id: user.id,
        p_sharing: false,
        p_latitude: null,
        p_longitude: null,
        p_accuracy_m: null
      });
      return sendJson(res, 200, result || { sharing: false });
    }
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracy = body.accuracy == null ? null : Number(body.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 10000))) {
      return fail(res, 400, "Location coordinates are invalid.");
    }
    const result = await supabase(config, "rpc/set_servepoint_artisan_location", "POST", {
      p_booking_id: bookingId,
      p_artisan_id: user.id,
      p_sharing: true,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracy
    });
    return sendJson(res, 200, result || { sharing: false });
  } catch (error) {
    console.error("[booking location]", error.message);
    return fail(res, 500, "Could not update live location.");
  }
}
module.exports = { handleBookingLocation };
