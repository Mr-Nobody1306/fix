"use strict";
const { sendJson } = require("./static");
const { authorizeAdmin } = require("./admin");
const { supabase, readBody } = require("./paystack");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function fail(res, status, message) {
  return sendJson(res, status, { error: message });
}
async function requestBody(req) {
  try { return JSON.parse((await readBody(req)).toString("utf8")); }
  catch (error) { throw Object.assign(new Error("Invalid request body."), { statusCode: error.statusCode || 400 }); }
}
async function authAdminRequest(config, userId, method, body) {
  const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
    method,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: "Bearer " + config.supabaseServiceRoleKey,
      "Content-Type": "application/json"
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); }
    catch (error) { throw new Error("Supabase Auth returned invalid JSON."); }
  }
  if (!response.ok) {
    const error = new Error("Supabase Auth admin request failed.");
    error.authStatus = response.status;
    throw error;
  }
  return result;
}
async function logEvent(config, admin, event) {
  const rows = await supabase(config, "admin_audit_events", "POST", {
    admin_email: String(admin.email || "").trim().toLowerCase(),
    action: event.action,
    target_id: event.targetId || null,
    target_label: event.targetLabel || null,
    reason: event.reason || null,
    details: event.details || {}
  }, "return=representation");
  if (!rows || !rows.length) throw new Error("Admin audit event could not be recorded.");
  return rows[0];
}
async function updateEvent(config, eventId, action, details) {
  const rows = await supabase(config, "admin_audit_events?id=eq." + encodeURIComponent(eventId),
    "PATCH", { action, details }, "return=representation");
  if (!rows || !rows.length) throw new Error("Admin audit event outcome could not be recorded.");
  return rows[0];
}
async function handlePublicServices(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const services = await supabase(config,
      "service_catalog?select=id,name,starting_price,description&active=eq.true&order=name.asc");
    return sendJson(res, 200, { services: services || [] });
  } catch (error) {
    console.error("[service catalog]", error.message);
    return fail(res, 503, "The service catalog is not available.");
  }
}
async function handleAdminUsers(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const profiles = await supabase(config,
      "profiles?select=id,name,role,trade,area,is_blocked,block_reason,blocked_at,created_at&order=created_at.desc&limit=1000");
    const authUsers = new Map();
    for (let page = 1; page <= 20; page++) {
      const response = await fetch(config.supabaseUrl + "/auth/v1/admin/users?page=" + page + "&per_page=1000", {
        headers: {
          apikey: config.supabaseServiceRoleKey,
          Authorization: "Bearer " + config.supabaseServiceRoleKey
        }
      });
      if (!response.ok) throw new Error("Supabase Auth user listing failed: " + response.status);
      const payload = await response.json();
      const pageUsers = payload && Array.isArray(payload.users) ? payload.users : [];
      pageUsers.forEach((user) => authUsers.set(user.id, user));
      if (pageUsers.length < 1000) break;
    }
    return sendJson(res, 200, {
      users: (profiles || []).map((profile) => {
        const authUser = authUsers.get(profile.id);
        return Object.assign({}, profile, {
          email: authUser && authUser.email || "",
          bannedUntil: authUser && authUser.banned_until || null
        });
      })
    });
  } catch (error) {
    console.error("[admin users]", error.message);
    return fail(res, 500, "Could not load user accounts.");
  }
}
async function handleAdminUserBlock(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const body = await requestBody(req);
    const userId = String(body.userId || "");
    if (!UUID_PATTERN.test(userId) || typeof body.blocked !== "boolean") {
      return fail(res, 400, "Choose a valid user and access state.");
    }
    const reason = String(body.reason || "").trim();
    if (reason.length < 5 || reason.length > 500) {
      return fail(res, 400, "Enter a reason between 5 and 500 characters.");
    }
    if (userId === admin.id) return fail(res, 403, "You cannot block or unblock your own admin account.");

    const payload = {
      p_admin_id: admin.id,
      p_admin_email: String(admin.email).trim().toLowerCase(),
      p_target_id: userId,
      p_blocked: body.blocked,
      p_reason: reason
    };
    if (body.blocked) {
      const result = await supabase(config, "rpc/admin_set_account_block", "POST", payload);
      if (result && result.error === "user_not_found") return fail(res, 404, "User account not found.");
      if (result && result.error === "admin_account_protected") return fail(res, 403, "Admin accounts cannot be blocked.");
      if (result && result.error === "cannot_change_own_access") return fail(res, 403, "You cannot block your own admin account.");
      try {
        await authAdminRequest(config, userId, "PATCH", { ban_duration: "876000h" });
      } catch (error) {
        console.error("[admin account ban]", error.message);
        return fail(res, 502, "ServePoint access is blocked, but sign-in could not be disabled. Retry this action.");
      }
      return sendJson(res, 200, { updated: !!(result && result.changed), user: result });
    }

    await authAdminRequest(config, userId, "PATCH", { ban_duration: "none" });
    const result = await supabase(config, "rpc/admin_set_account_block", "POST", payload);
    if (result && result.error === "user_not_found") return fail(res, 404, "User account not found.");
    if (result && result.error === "admin_account_protected") return fail(res, 403, "Admin accounts cannot be unblocked here.");
    return sendJson(res, 200, { updated: !!(result && result.changed), user: result });
  } catch (error) {
    console.error("[admin account access]", error.message);
    return fail(res, error.statusCode || 500, error.message || "Could not update account access.");
  }
}
async function handleAdminUserDelete(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const body = await requestBody(req);
    const userId = String(body.userId || "");
    const reason = String(body.reason || "").trim();
    if (!UUID_PATTERN.test(userId)) return fail(res, 400, "Choose a valid user account.");
    if (reason.length < 5 || reason.length > 500) return fail(res, 400, "Enter a deletion reason between 5 and 500 characters.");
    if (userId === admin.id) return fail(res, 403, "You cannot delete your own admin account.");

    const profiles = await supabase(config,
      "profiles?select=id,name,role,is_blocked&id=eq." + encodeURIComponent(userId) + "&limit=1");
    const target = profiles && profiles[0];
    if (!target) return fail(res, 404, "User account not found.");
    if (target.role === "admin") return fail(res, 403, "Admin accounts cannot be deleted here.");

    if (target.role === "artisan") {
      const activeJobs = await supabase(config,
        "bookings?select=id,status&artisan_id=eq." + encodeURIComponent(userId) +
        "&status=in.(enroute,arrived,working)&limit=1");
      if (activeJobs && activeJobs.length) {
        return fail(res, 409, "This artisan has an active accepted job. Resolve it before deleting the account.");
      }
    }

    const bookings = await supabase(config,
      "bookings?select=id,service,status,total,payment_reference,owner_id,customer_id&or=(owner_id.eq." +
      encodeURIComponent(userId) + ",customer_id.eq." + encodeURIComponent(userId) + ")&limit=500");
    if (bookings && bookings.length >= 500) {
      return fail(res, 409, "This account has too many bookings to snapshot safely. Contact support.");
    }
    const bookingIds = (bookings || []).map((booking) => booking.id);
    const payments = bookingIds.length ? await supabase(config,
      "booking_payment_state?select=booking_id,payment_reference,payout_reference,payment_status,payout_status&booking_id=in.(" +
      bookingIds.map(encodeURIComponent).join(",") + ")") : [];
    const paymentByBooking = new Map((payments || []).map((payment) => [payment.booking_id, payment]));
    const audit = await logEvent(config, admin, {
      action: "user_delete_started",
      targetId: userId,
      targetLabel: target.name,
      reason,
      details: {
        role: target.role,
        isBlocked: !!target.is_blocked,
        bookings: (bookings || []).map((booking) => ({
          id: booking.id,
          service: booking.service,
          status: booking.status,
          total: booking.total,
          paymentReference: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payment_reference || booking.payment_reference || null,
          payoutReference: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payout_reference || null,
          paymentStatus: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payment_status || null,
          payoutStatus: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payout_status || null
        }))
      }
    });
    try {
      await authAdminRequest(config, userId, "DELETE");
    } catch (error) {
      console.error("[admin user deletion]", error.message);
      try {
        await updateEvent(config, audit.id, "user_delete_failed", Object.assign({}, audit.details, {
          failureStatus: error.authStatus || null
        }));
      } catch (auditError) {
        console.error("[admin deletion audit]", auditError.message);
      }
      return fail(res, 502, "Account deletion failed. The attempt was recorded in the audit log.");
    }
    try {
      await updateEvent(config, audit.id, "user_deleted", audit.details);
    } catch (error) {
      console.error("[admin deletion audit]", error.message);
      return fail(res, 500, "The account was deleted, but the audit outcome could not be updated. Contact support.");
    }
    return sendJson(res, 200, { deleted: true, userId, bookingsDeleted: bookingIds.length });
  } catch (error) {
    console.error("[admin user deletion]", error.message);
    return fail(res, error.statusCode || 500, error.message || "Could not delete the user account.");
  }
}
async function handleAdminServices(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const services = await supabase(config,
      "service_catalog?select=id,name,starting_price,description,active,created_at,updated_at&order=name.asc");
    return sendJson(res, 200, { services: services || [] });
  } catch (error) {
    console.error("[admin services]", error.message);
    return fail(res, 500, "Could not load services.");
  }
}
async function handleAdminServiceCreate(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const body = await requestBody(req);
    const name = String(body.name || "").trim();
    const id = String(body.id || "").trim().toLowerCase();
    const description = String(body.description || "").trim();
    const startingPrice = Number(body.startingPrice);
    if (!SERVICE_ID_PATTERN.test(id) || id.length > 60) return fail(res, 400, "Use a lowercase trade key such as carpentry or appliance-repair.");
    if (!/^[\p{L}\p{N}][\p{L}\p{N} &'()/-]{1,79}$/u.test(name)) return fail(res, 400, "Service name must be 2–80 letters, numbers, spaces, or basic punctuation.");
    if (!Number.isFinite(startingPrice) || startingPrice < 0 || startingPrice > 100000) {
      return fail(res, 400, "Enter a starting price from GH₵0 to GH₵100,000.");
    }
    if (description.length > 240) return fail(res, 400, "Description must be 240 characters or fewer.");
    const result = await supabase(config, "rpc/admin_create_service", "POST", {
      p_admin_email: String(admin.email).trim().toLowerCase(),
      p_service_id: id,
      p_name: name,
      p_starting_price: startingPrice,
      p_description: description
    });
    if (result && result.error === "service_exists") return fail(res, 409, "A service with that trade key or name already exists.");
    if (result && result.error === "invalid_service") return fail(res, 400, "The service details are invalid.");
    const service = result && result.service;
    if (!service) throw new Error("Service was not saved.");
    return sendJson(res, 201, { service });
  } catch (error) {
    console.error("[admin service create]", error.message);
    return fail(res, error.statusCode || 500, error.message || "Could not add the service.");
  }
}
async function handleAdminServiceStatus(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const body = await requestBody(req);
    const id = String(body.id || "").trim().toLowerCase();
    if (!SERVICE_ID_PATTERN.test(id) || typeof body.active !== "boolean") {
      return fail(res, 400, "Choose a valid service and active state.");
    }
    const reason = String(body.reason || "").trim();
    if (!body.active && (reason.length < 5 || reason.length > 500)) {
      return fail(res, 400, "Enter a reason between 5 and 500 characters to remove a service.");
    }
    const result = await supabase(config, "rpc/admin_set_service_active", "POST", {
      p_admin_email: String(admin.email).trim().toLowerCase(),
      p_service_id: id,
      p_active: body.active,
      p_reason: reason || null
    });
    if (result && result.error === "service_not_found") return fail(res, 404, "Service not found.");
    if (result && result.error === "invalid_service") return fail(res, 400, "The service details are invalid.");
    if (result && result.error === "valid_reason_required") return fail(res, 400, "A valid removal reason is required.");
    const service = result && result.service;
    if (!service) throw new Error("Service status was not updated.");
    return sendJson(res, 200, { updated: !!result.changed, service });
  } catch (error) {
    console.error("[admin service status]", error.message);
    return fail(res, error.statusCode || 500, error.message || "Could not update the service.");
  }
}
async function handleAdminBookings(req, res, config) {
  if (req.method !== "GET") return fail(res, 405, "Use GET.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const bookings = await supabase(config,
      "bookings?select=id,service,area,status,total,created_at,owner_id,customer_id&order=created_at.desc&limit=500");
    const ids = (bookings || []).map((booking) => booking.id);
    const payments = ids.length ? await supabase(config,
      "booking_payment_state?select=booking_id,payment_status,payout_status&booking_id=in.(" +
      ids.map(encodeURIComponent).join(",") + ")") : [];
    const paymentByBooking = new Map((payments || []).map((payment) => [payment.booking_id, payment]));
    return sendJson(res, 200, {
      bookings: (bookings || []).map((booking) => Object.assign({}, booking, {
        payment_status: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payment_status || null,
        payout_status: paymentByBooking.get(booking.id) && paymentByBooking.get(booking.id).payout_status || null
      }))
    });
  } catch (error) {
    console.error("[admin bookings]", error.message);
    return fail(res, 500, "Could not load bookings.");
  }
}
async function handleAdminBookingDelete(req, res, config) {
  if (req.method !== "POST") return fail(res, 405, "Use POST.");
  try {
    const admin = await authorizeAdmin(req, res, config);
    if (!admin) return;
    const body = await requestBody(req);
    const bookingId = String(body.bookingId || "");
    const reason = String(body.reason || "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(bookingId)) return fail(res, 400, "Choose a valid booking.");
    if (reason.length < 5 || reason.length > 500) return fail(res, 400, "Enter a deletion reason between 5 and 500 characters.");
    const bookings = await supabase(config,
      "bookings?select=id,service,area,status,total,payment_reference,owner_id,customer_id&id=eq." +
      encodeURIComponent(bookingId) + "&limit=1");
    const booking = bookings && bookings[0];
    if (!booking) return fail(res, 404, "Booking not found.");
    const payments = await supabase(config,
      "booking_payment_state?select=payment_reference,payout_reference,payment_status,payout_status&booking_id=eq." +
      encodeURIComponent(bookingId) + "&limit=1");
    const payment = payments && payments[0] || {};
    const audit = await logEvent(config, admin, {
      action: "booking_delete_started", targetId: booking.id, targetLabel: booking.service,
      reason,
      details: {
        area: booking.area, status: booking.status, total: booking.total,
        paymentReference: payment.payment_reference || booking.payment_reference || null,
        payoutReference: payment.payout_reference || null,
        paymentStatus: payment.payment_status || null, payoutStatus: payment.payout_status || null
      }
    });
    try {
      await supabase(config, "bookings?id=eq." + encodeURIComponent(bookingId), "DELETE");
    } catch (error) {
      console.error("[admin booking deletion]", error.message);
      try {
        await updateEvent(config, audit.id, "booking_delete_failed",
          Object.assign({}, audit.details, { failure: "Database deletion failed" }));
      } catch (auditError) {
        console.error("[admin booking audit]", auditError.message);
      }
      return fail(res, 500, "Booking deletion failed. The attempt was recorded in the audit log.");
    }
    try {
      await updateEvent(config, audit.id, "booking_deleted", audit.details);
    } catch (error) {
      console.error("[admin booking audit]", error.message);
      return fail(res, 500, "The booking was deleted, but the audit outcome could not be updated. Contact support.");
    }
    return sendJson(res, 200, { deleted: true, bookingId });
  } catch (error) {
    console.error("[admin booking deletion]", error.message);
    return fail(res, error.statusCode || 500, error.message || "Could not delete the booking.");
  }
}
module.exports = {
  handlePublicServices,
  handleAdminUsers,
  handleAdminUserBlock,
  handleAdminUserDelete,
  handleAdminServices,
  handleAdminServiceCreate,
  handleAdminServiceStatus,
  handleAdminBookings,
  handleAdminBookingDelete
};
