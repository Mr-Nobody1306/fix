"use strict";
const t = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { handleChat, isRefundQuestion, REFUND_RESPONSE } = require("../src/chat");

function fakeResponse() {
  return {
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body) { this.body = body; }
  };
}

t.test("refund questions receive a fixed answer without requiring AI configuration", async function () {
  assert.equal(isRefundQuestion("Has my refund been completed?"), true);
  assert.equal(isRefundQuestion("How do I get my money back?"), true);
  assert.equal(isRefundQuestion("How do I book a plumber?"), false);

  const req = Readable.from([Buffer.from(JSON.stringify({
    messages: [{ role: "user", content: "Was my refund issued?" }]
  }))]);
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = fakeResponse();
  await handleChat(req, res, {
    config: { maxBodyBytes: 4096, maxMessages: 12, maxMessageChars: 2000, groqKey: "" },
    limiter: { isLimited: function () { return false; } }
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { reply: REFUND_RESPONSE, service: null, detail: "" });
  assert.match(REFUND_RESPONSE, /cannot verify whether a refund was issued or completed/i);
});
