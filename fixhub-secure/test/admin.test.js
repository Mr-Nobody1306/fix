"use strict";
const t = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { handleAdminArtisans, handleAdminSuspension } = require("../src/admin");

const config = {
  adminEmail: "owner@example.com",
  supabaseUrl: "https://project.supabase.co",
  supabaseAnonKey: "anon-test-key",
  supabaseServiceRoleKey: "service-test-key"
};
function makeRequest(method, body) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = method === "GET" ? "/api/admin/artisans" : "/api/admin/suspension";
  req.headers = { authorization: "Bearer user-access-token" };
  return req;
}
function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body || ""; },
    json() { return JSON.parse(this.body); }
  };
}
function googleUser(email) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "google", providers: ["google"] }
  };
}

t.test("admin artisan list requires the exact authorized Google account", async () => {
  const originalFetch = global.fetch;
  let restCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return { ok: true, json: async () => googleUser("someone-else@example.com") };
    }
    restCalls++;
    throw new Error("Admin data must not be fetched for an unauthorized user.");
  };
  try {
    const res = makeResponse();
    await handleAdminArtisans(makeRequest("GET"), res, config);
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error, /not authorized/i);
    assert.equal(restCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("admin access rejects the allowlisted email when it is not a Google identity", async () => {
  const originalFetch = global.fetch;
  let restCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return {
        ok: true,
        json: async () => ({
          id: "00000000-0000-4000-8000-000000000001",
          email: "owner@example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          app_metadata: { provider: "email", providers: ["email"] }
        })
      };
    }
    restCalls++;
    throw new Error("Non-Google login must not access admin data.");
  };
  try {
    const res = makeResponse();
    await handleAdminArtisans(makeRequest("GET"), res, config);
    assert.equal(res.statusCode, 403);
    assert.equal(restCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("admin artisan list uses the server service-role key after verification", async () => {
  const originalFetch = global.fetch;
  let listRequest;
  global.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      return { ok: true, json: async () => googleUser("OWNER@example.com") };
    }
    if (url.includes("/rest/v1/profiles?select=is_blocked")) {
      return { ok: true, text: async () => "[]" };
    }
    listRequest = { url, options };
    return {
      ok: true,
      text: async () => JSON.stringify([{ id: "artisan-id", name: "Test artisan", is_suspended: false }])
    };
  };
  try {
    const res = makeResponse();
    await handleAdminArtisans(makeRequest("GET"), res, config);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().artisans[0].name, "Test artisan");
    assert.match(listRequest.url, /role=eq\.artisan/);
    assert.equal(listRequest.options.headers.Authorization, "Bearer service-test-key");
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("suspension uses the audited server-side RPC", async () => {
  const originalFetch = global.fetch;
  let rpcRequest;
  global.fetch = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      return { ok: true, json: async () => googleUser("owner@example.com") };
    }
    if (url.includes("/rest/v1/profiles?select=is_blocked")) {
      return { ok: true, text: async () => "[]" };
    }
    rpcRequest = { url, options };
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: "00000000-0000-4000-8000-000000000002",
        is_suspended: true,
        changed: true
      })
    };
  };
  try {
    const res = makeResponse();
    const req = makeRequest("POST", {
      artisanId: "00000000-0000-4000-8000-000000000002",
      suspended: true,
      reason: "Repeated safety complaints"
    });
    await handleAdminSuspension(req, res, config);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().updated, true);
    assert.match(rpcRequest.url, /rpc\/admin_set_artisan_suspension$/);
    assert.equal(rpcRequest.options.headers.Authorization, "Bearer service-test-key");
    assert.equal(JSON.parse(rpcRequest.options.body).p_admin_email, "owner@example.com");
  } finally {
    global.fetch = originalFetch;
  }
});

t.test("admin mutation validates suspension reason before calling the database", async () => {
  const originalFetch = global.fetch;
  let rpcCalls = 0;
  global.fetch = async (url) => {
    if (url.endsWith("/auth/v1/user")) {
      return { ok: true, json: async () => googleUser("owner@example.com") };
    }
    if (url.includes("/rest/v1/profiles?select=is_blocked")) {
      return { ok: true, text: async () => "[]" };
    }
    rpcCalls++;
    throw new Error("Invalid suspension reason must not reach the database.");
  };
  try {
    const res = makeResponse();
    const req = makeRequest("POST", {
      artisanId: "00000000-0000-4000-8000-000000000002",
      suspended: true,
      reason: "no"
    });
    await handleAdminSuspension(req, res, config);
    assert.equal(res.statusCode, 400);
    assert.equal(rpcCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
