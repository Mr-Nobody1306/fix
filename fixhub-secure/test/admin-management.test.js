"use strict";
const t = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  handleAdminServiceCreate,
  handleAdminServiceStatus,
  handleAdminUserBlock
} = require("../src/admin-management");

const config = {
  adminEmail: "owner@example.com",
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "anon-test-key",
  supabaseServiceRoleKey: "service-test-key"
};
const ADMIN_ID = "00000000-0000-4000-8000-000000000001";

function request(method, body) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = "/api/admin/services";
  req.headers = { authorization: "Bearer user-access-token" };
  return req;
}
function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body || ""; },
    json() { return JSON.parse(this.body); }
  };
}
function googleUser(id, email) {
  return {
    id,
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] }
  };
}
function authorizeMock(url, options) {
  if (url.endsWith("/auth/v1/user")) {
    return { ok: true, json: async () => googleUser(ADMIN_ID, "owner@example.com") };
  }
  if (url.includes("/rest/v1/profiles?select=is_blocked")) {
    return { ok: true, text: async () => "[]" };
  }
  return null;
}

t.test("service creation validates before making a database mutation", async () => {
  const originalFetch = global.fetch;
  let rpcCalls = 0;
  global.fetch = async (url, options) => {
    const auth = authorizeMock(url, options);
    if (auth) return auth;
    rpcCalls++;
    throw new Error("Invalid service details must not reach the database.");
  };
  try {
    const res = response();
    await handleAdminServiceCreate(request("POST", {
      id: "Carpentry", name: "Carpentry", startingPrice: -1
    }), res, config);
    assert.equal(res.statusCode, 400);
    assert.equal(rpcCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("service creation uses an audited server-side transaction", async () => {
  const originalFetch = global.fetch;
  let rpcRequest;
  global.fetch = async (url, options) => {
    const auth = authorizeMock(url, options);
    if (auth) return auth;
    rpcRequest = { url, options };
    return {
      ok: true,
      text: async () => JSON.stringify({
        service: { id: "appliance-repair", name: "Appliance Repair", starting_price: 125, active: true }
      })
    };
  };
  try {
    const res = response();
    await handleAdminServiceCreate(request("POST", {
      id: "appliance-repair",
      name: "Appliance Repair",
      startingPrice: 125,
      description: "Repairs and diagnostics"
    }), res, config);
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().service.id, "appliance-repair");
    assert.match(rpcRequest.url, /rpc\/admin_create_service$/);
    assert.equal(rpcRequest.options.headers.Authorization, "Bearer service-test-key");
    assert.equal(JSON.parse(rpcRequest.options.body).p_admin_email, "owner@example.com");
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("service removal requires a reason before calling the database", async () => {
  const originalFetch = global.fetch;
  let rpcCalls = 0;
  global.fetch = async (url, options) => {
    const auth = authorizeMock(url, options);
    if (auth) return auth;
    rpcCalls++;
    throw new Error("Service removal without a reason must not reach the database.");
  };
  try {
    const res = response();
    await handleAdminServiceStatus(request("POST", {
      id: "carpentry", active: false, reason: "no"
    }), res, config);
    assert.equal(res.statusCode, 400);
    assert.equal(rpcCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("the admin cannot block their own account", async () => {
  const originalFetch = global.fetch;
  let rpcCalls = 0;
  global.fetch = async (url, options) => {
    const auth = authorizeMock(url, options);
    if (auth) return auth;
    rpcCalls++;
    throw new Error("Self-blocking must not reach the database.");
  };
  try {
    const res = response();
    await handleAdminUserBlock(request("POST", {
      userId: ADMIN_ID, blocked: true, reason: "Administrative reason"
    }), res, config);
    assert.equal(res.statusCode, 403);
    assert.equal(rpcCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
