const CATALOG = new Map([
  ["Brown Sugar Cinnamon Latte", 600],
  ["Gourmet Sea Salt Caramel Latte", 600],
  ["Midnight Mocha Latte", 600],
  ["Double Vanilla Bean Oatmilk Latte", 600],
  ["Copycat Blondie Latte", 600],
  ["Sweet & Salty Hazelnut Latte", 600],
  ["White Chocolate Mocha Latte", 600]
]);

// Each pack unlocks one discounted add-on bottle, priced by the pack it came with.
const BONUS_PRICE_BY_PACK = new Map([[3, 500], [6, 400]]);

const DEFAULT_PICKUP_WINDOW = "Details confirmed by text";
const ALLOWED_WINDOWS = new Set(["Morning", "Afternoon", "Evening", DEFAULT_PICKUP_WINDOW]);
const ALLOWED_STATUSES = new Set(["new", "confirmed", "preparing", "ready", "picked_up", "cancelled"]);
const SQUARE_API_VERSION = "2026-07-15";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/orders" && request.method === "POST") {
        if (isRateLimited(request)) {
          return json({ok: false, error: "Too many orders from this connection. Please wait a few minutes and try again, or text us instead."}, 429);
        }
        return await createOrder(request, env, ctx);
      }

      if (url.pathname === "/api/square/config" && request.method === "GET") {
        return squareConfig(env);
      }

      if (url.pathname === "/api/payments/order-summary" && request.method === "POST") {
        if (isRateLimited(request, "payment-summary", 30)) {
          return json({ok: false, error: "Too many payment requests. Please wait a moment and try again."}, 429);
        }
        return await getPaymentOrderSummary(request, env);
      }

      if (url.pathname === "/api/payments" && request.method === "POST") {
        if (isRateLimited(request, "payment", 12)) {
          return json({ok: false, error: "Too many payment attempts. Please wait a few minutes and try again."}, 429);
        }
        return await createSquarePayment(request, env, ctx);
      }

      if (url.pathname === "/api/orders" && request.method === "GET") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return await listOrders(url, env);
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/(\d+)$/);
      if (orderMatch && request.method === "PATCH") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;
        return await updateOrder(request, env, Number(orderMatch[1]));
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") {
        const auth = requireAdmin(request, env);
        if (auth) return auth;

        const adminUrl = new URL("/admin.html", url.origin);
        return env.ASSETS.fetch(adminUrl);
      }

      if (url.pathname === "/pay" || url.pathname === "/pay/" || url.pathname === "/pay.html") {
        const payUrl = new URL("/pay.html", url.origin);
        const response = await env.ASSETS.fetch(payUrl);
        return withPaymentSecurityHeaders(response);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Unhandled worker error", error);
      return json({ok: false, error: "The server could not complete that request."}, 500);
    }
  }
};

let schemaReady = false;

async function ensureDatabase(env) {
  if (schemaReady) return;
  if (!env.DB) throw new Error("D1 binding DB is not available.");

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_email TEXT,
        pickup_date TEXT NOT NULL,
        pickup_window TEXT NOT NULL,
        notes TEXT,
        subtotal_cents INTEGER NOT NULL,
        bottle_count INTEGER NOT NULL,
        items_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        square_payment_link TEXT,
        payment_access_hash TEXT,
        payment_status TEXT NOT NULL DEFAULT 'UNPAID',
        payment_attempt INTEGER NOT NULL DEFAULT 0,
        payment_updated_at TEXT,
        square_payment_id TEXT,
        square_receipt_url TEXT,
        paid_at TEXT
      )
    `),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`)
  ]);

  try {
    await env.DB.prepare(`ALTER TABLE orders ADD COLUMN square_payment_link TEXT`).run();
  } catch (error) {
    if (!String(error.message || error).toLowerCase().includes("duplicate column")) throw error;
  }

  const paymentColumns = [
    "payment_access_hash TEXT",
    "payment_status TEXT NOT NULL DEFAULT 'UNPAID'",
    "payment_attempt INTEGER NOT NULL DEFAULT 0",
    "payment_updated_at TEXT",
    "square_payment_id TEXT",
    "square_receipt_url TEXT",
    "paid_at TEXT"
  ];

  for (const column of paymentColumns) {
    try {
      await env.DB.prepare(`ALTER TABLE orders ADD COLUMN ${column}`).run();
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("duplicate column")) throw error;
    }
  }

  schemaReady = true;
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitState = new Map();

function isRateLimited(request, bucket = "orders", maxRequests = RATE_LIMIT_MAX) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (rateLimitState.size > 10_000) rateLimitState.clear();

  const timestamps = (rateLimitState.get(key) || []).filter(ts => ts > windowStart);

  if (timestamps.length >= maxRequests) {
    rateLimitState.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  rateLimitState.set(key, timestamps);
  return false;
}

const MAX_ORDER_BYTES = 50_000;

async function readLimitedJson(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return {body: null};

  const chunks = [];
  let total = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return {tooLarge: true};
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {body: JSON.parse(new TextDecoder().decode(buffer))};
  } catch {
    return {body: null};
  }
}

async function createOrder(request, env, ctx) {
  const payload = await readLimitedJson(request, MAX_ORDER_BYTES);
  if (payload.tooLarge) return json({ok: false, error: "Order request is too large."}, 413);

  const body = payload.body;
  if (!body || typeof body !== "object") return json({ok: false, error: "Invalid order."}, 400);

  // Quiet bot trap. A normal customer never sees or fills this field.
  if (String(body.website || "").trim()) {
    return json({ok: true, orderNumber: "RP-RECEIVED", subtotal: 0}, 200);
  }

  if (body.paymentRequired === true && !squareIsConfigured(env)) {
    return json({ok: false, error: "Online card payment is temporarily unavailable. Please text us for help."}, 503);
  }

  const customer = body.customer || {};
  const customerName = clean(customer.name, 80);
  const customerPhone = clean(customer.phone, 24);
  const customerEmail = clean(customer.email, 120);
  const pickupDate = clean(body.pickupDate, 10);
  const pickupWindow = clean(body.pickupWindow, 40) || DEFAULT_PICKUP_WINDOW;
  const notes = clean(body.notes, 500);

  if (customerName.length < 2) return json({ok: false, error: "Please enter your name."}, 400);
  const phoneDigits = customerPhone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || /[a-zA-Z]/.test(customerPhone)) {
    return json({ok: false, error: "Please enter a valid phone number."}, 400);
  }
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return json({ok: false, error: "Please enter a valid email address."}, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return json({ok: false, error: "Pickup date is invalid."}, 400);
  }
  if (!ALLOWED_WINDOWS.has(pickupWindow)) {
    return json({ok: false, error: "Pickup window is invalid."}, 400);
  }

  const parsed = validateItems(body.items);
  if (!parsed.ok) return json({ok: false, error: parsed.error}, 400);

  await ensureDatabase(env);

  const createdAt = new Date().toISOString();
  const paymentAccessToken = makePaymentAccessToken();
  const paymentAccessHash = await hashPaymentAccessToken(paymentAccessToken);
  let orderNumber = "";
  let inserted = false;

  for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
    orderNumber = makeOrderNumber(createdAt);

    try {
      await env.DB.prepare(`
        INSERT INTO orders (
          order_number, created_at, customer_name, customer_phone, customer_email,
          pickup_date, pickup_window, notes, subtotal_cents, bottle_count, items_json, status,
          payment_access_hash, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, 'UNPAID')
      `).bind(
        orderNumber,
        createdAt,
        customerName,
        customerPhone,
        customerEmail || null,
        pickupDate,
        pickupWindow,
        notes || null,
        parsed.subtotal,
        parsed.bottleCount,
        JSON.stringify(parsed.items),
        paymentAccessHash
      ).run();
      inserted = true;
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("unique")) throw error;
    }
  }

  if (!inserted) throw new Error("Could not create a unique order number.");

  const paymentPath = squareIsConfigured(env)
    ? makePaymentPath(orderNumber, paymentAccessToken)
    : null;
  return json({
    ok: true,
    orderNumber,
    subtotal: parsed.subtotal,
    bottleCount: parsed.bottleCount,
    pickupDate,
    pickupWindow,
    paymentPath,
    paymentAvailable: Boolean(paymentPath)
  }, 201);
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return {ok: false, error: "Your cart is empty or too large."};
  }

  let subtotal = 0;
  let bottleCount = 0;
  const packByTier = new Map();
  const bonusByTier = new Map();
  const normalized = [];
  const tally = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const item of items) {
    if (!item || typeof item !== "object") return {ok: false, error: "An order item is invalid."};

    if (item.type === "single") {
      const name = clean(item.name, 100);
      const qty = Number(item.qty);
      // item.bonus carries the size of the pack that unlocked it; anything
      // unrecognised simply falls through and is charged at full price.
      const bonusTier = Number(item.bonus);
      const isBonus = BONUS_PRICE_BY_PACK.has(bonusTier);

      if (!CATALOG.has(name) || !Number.isInteger(qty) || qty < 1 || qty > 24) {
        return {ok: false, error: "A single-bottle item is invalid."};
      }
      if (isBonus && qty !== 1) {
        return {ok: false, error: "A pack add-on bottle is invalid."};
      }

      subtotal += (isBonus ? BONUS_PRICE_BY_PACK.get(bonusTier) : CATALOG.get(name)) * qty;
      bottleCount += qty;
      if (isBonus) tally(bonusByTier, bonusTier);
      normalized.push(isBonus ? {type: "single", name, qty, bonus: bonusTier} : {type: "single", name, qty});
      continue;
    }

    if (item.type === "pack") {
      const size = Number(item.size);
      const flavors = Array.isArray(item.flavors) ? item.flavors.map(value => clean(value, 100)) : [];

      if (![3, 6].includes(size) || flavors.length !== size || flavors.some(name => !CATALOG.has(name))) {
        return {ok: false, error: "A custom pack is invalid."};
      }

      subtotal += size === 3 ? 1700 : 3000;
      bottleCount += size;
      tally(packByTier, size);
      normalized.push({type: "pack", size, flavors});
      continue;
    }

    return {ok: false, error: "An order item type is invalid."};
  }

  // One discounted bottle per matching pack, checked after the loop so item
  // order does not matter and a 6-pack price cannot be claimed off a 3-pack.
  for (const [tier, count] of bonusByTier) {
    if (count > (packByTier.get(tier) || 0)) {
      return {ok: false, error: "A discounted bottle requires a matching pack."};
    }
  }

  if (bottleCount > 48) return {ok: false, error: "Please contact us for orders over 48 bottles."};
  return {ok: true, subtotal, bottleCount, items: normalized};
}

async function listOrders(url, env) {
  await ensureDatabase(env);

  const requestedStatus = clean(url.searchParams.get("status"), 20);
  let result;

  if (requestedStatus && ALLOWED_STATUSES.has(requestedStatus)) {
    result = await env.DB.prepare(`
      SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 500
    `).bind(requestedStatus).all();
  } else {
    result = await env.DB.prepare(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT 500
    `).all();
  }

  const orders = (result.results || []).map(row => ({
    ...row,
    items: safeParseItems(row.items_json)
  }));

  return json({ok: true, orders});
}

async function updateOrder(request, env, id) {
  const body = await request.json().catch(() => null);
  const status = clean(body?.status, 20);

  if (!ALLOWED_STATUSES.has(status)) return json({ok: false, error: "Invalid status."}, 400);

  await ensureDatabase(env);
  const result = await env.DB.prepare(`UPDATE orders SET status = ? WHERE id = ?`)
    .bind(status, id)
    .run();

  if (!result.meta?.changes) return json({ok: false, error: "Order not found."}, 404);
  return json({ok: true});
}

function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return new Response("Admin access is not configured. Add an ADMIN_PASSWORD secret to this Worker.", {
      status: 503,
      headers: {"Content-Type": "text/plain; charset=utf-8"}
    });
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Basic ")) return adminChallenge();

  let decoded = "";
  try {
    decoded = atob(authorization.slice(6));
  } catch {
    return adminChallenge();
  }

  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (!constantTimeEqual(username, "admin") || !constantTimeEqual(password, env.ADMIN_PASSWORD)) {
    return adminChallenge();
  }

  return null;
}

function adminChallenge() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Rally Point Orders", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  let mismatch = left.length ^ right.length;
  const max = Math.max(left.length, right.length);

  for (let index = 0; index < max; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function squareIsConfigured(env) {
  return Boolean(env.SQUARE_APPLICATION_ID && env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

function squareConfig(env) {
  if (!squareIsConfigured(env)) {
    return json({ok: true, enabled: false});
  }

  return json({
    ok: true,
    enabled: true,
    applicationId: env.SQUARE_APPLICATION_ID,
    locationId: env.SQUARE_LOCATION_ID,
    environment: env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production"
  });
}

function makePaymentPath(orderNumber, accessToken) {
  const params = new URLSearchParams({order: orderNumber, token: accessToken});
  return `/pay#${params}`;
}

function makePaymentAccessToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashPaymentAccessToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readPaymentRequest(request) {
  const payload = await readLimitedJson(request, 12_000);
  if (payload.tooLarge) return {error: json({ok: false, error: "Payment request is too large."}, 413)};

  const body = payload.body;
  const orderNumber = clean(body?.orderNumber, 40);
  const accessToken = clean(body?.accessToken, 100);
  if (!/^RP-[A-Z0-9-]+$/.test(orderNumber) || accessToken.length < 24) {
    return {error: json({ok: false, error: "This payment link is invalid."}, 400)};
  }

  return {body, orderNumber, accessHash: await hashPaymentAccessToken(accessToken)};
}

async function getPaymentOrderSummary(request, env) {
  const parsed = await readPaymentRequest(request);
  if (parsed.error) return parsed.error;

  await ensureDatabase(env);
  const order = await env.DB.prepare(`
    SELECT order_number, customer_name, customer_phone, customer_email, pickup_date,
      pickup_window, subtotal_cents, bottle_count, payment_status, square_receipt_url
    FROM orders WHERE order_number = ? AND payment_access_hash = ?
  `).bind(parsed.orderNumber, parsed.accessHash).first();

  if (!order) return json({ok: false, error: "This payment link is invalid or has expired."}, 404);

  const nameParts = String(order.customer_name || "").trim().split(/\s+/);
  return json({
    ok: true,
    order: {
      orderNumber: order.order_number,
      amountCents: order.subtotal_cents,
      bottleCount: order.bottle_count,
      pickupDate: order.pickup_date,
      pickupWindow: order.pickup_window,
      paymentStatus: order.payment_status || "UNPAID",
      receiptUrl: order.square_receipt_url || null,
      customer: {
        givenName: nameParts.shift() || "Customer",
        familyName: nameParts.join(" "),
        email: order.customer_email || "",
        phone: order.customer_phone || "",
        countryCode: "US"
      }
    }
  });
}

async function createSquarePayment(request, env, ctx) {
  if (!squareIsConfigured(env)) {
    return json({ok: false, error: "Online card payment is temporarily unavailable. Please text us for help."}, 503);
  }

  const parsed = await readPaymentRequest(request);
  if (parsed.error) return parsed.error;
  const sourceId = clean(parsed.body?.sourceId, 512);
  if (!sourceId) return json({ok: false, error: "Card details could not be verified. Please try again."}, 400);

  await ensureDatabase(env);
  const existing = await env.DB.prepare(`
    SELECT * FROM orders WHERE order_number = ? AND payment_access_hash = ?
  `).bind(parsed.orderNumber, parsed.accessHash).first();

  if (!existing) return json({ok: false, error: "This payment link is invalid or has expired."}, 404);
  if (existing.payment_status === "COMPLETED") {
    return json({ok: true, paymentStatus: "COMPLETED", receiptUrl: existing.square_receipt_url || null});
  }
  if (existing.payment_status === "PROCESSING") {
    return json({
      ok: false,
      error: "Square is still confirming this payment. Please do not submit it again. Check your email, or text us if it does not update shortly."
    }, 409);
  }

  const now = new Date();
  const claimed = await env.DB.prepare(`
    UPDATE orders
    SET payment_status = 'PROCESSING',
        payment_attempt = COALESCE(payment_attempt, 0) + 1,
        payment_updated_at = ?
    WHERE order_number = ? AND payment_access_hash = ?
      AND (
        payment_status IS NULL OR payment_status IN ('UNPAID', 'FAILED')
      )
    RETURNING *
  `).bind(now.toISOString(), parsed.orderNumber, parsed.accessHash).first();

  if (!claimed) {
    return json({ok: false, error: "This payment is already being processed. Please wait a moment before trying again."}, 409);
  }

  const base = env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
  const idempotencyKey = `${claimed.order_number}-${claimed.payment_attempt}`.slice(0, 45);

  let squareResponse;
  let squareData;
  try {
    squareResponse = await fetch(`${base}/v2/payments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_API_VERSION
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        amount_money: {amount: claimed.subtotal_cents, currency: "USD"},
        autocomplete: true,
        location_id: env.SQUARE_LOCATION_ID,
        reference_id: claimed.order_number,
        note: `Rally Point website order ${claimed.order_number}`,
        ...(claimed.customer_email ? {buyer_email_address: claimed.customer_email} : {})
      })
    });
    squareData = await squareResponse.json().catch(() => ({}));
  } catch (error) {
    console.error("Square payment request failed", error);
    return json({
      ok: false,
      error: "Square did not confirm whether the payment completed. Please do not submit it again. Check your email, or text us for help."
    }, 502);
  }

  if (!squareResponse.ok || !squareData.payment) {
    console.error("Square payment failed", squareResponse.status, JSON.stringify(squareData.errors || []));
    await markPaymentFailed(env, claimed);
    return json({ok: false, error: friendlySquareError(squareData.errors)}, 402);
  }

  const payment = squareData.payment;
  const paymentStatus = payment.status === "COMPLETED" ? "COMPLETED" : "FAILED";
  const paidAt = paymentStatus === "COMPLETED" ? (payment.updated_at || new Date().toISOString()) : null;

  await env.DB.prepare(`
    UPDATE orders SET payment_status = ?, payment_updated_at = ?, square_payment_id = ?,
      square_receipt_url = ?, paid_at = ?
    WHERE id = ? AND payment_attempt = ?
  `).bind(
    paymentStatus,
    new Date().toISOString(),
    payment.id || null,
    payment.receipt_url || null,
    paidAt,
    claimed.id,
    claimed.payment_attempt
  ).run();

  if (paymentStatus !== "COMPLETED") {
    return json({ok: false, error: "Square did not complete the payment. Please try another card."}, 402);
  }

  if (env.RESEND_API_KEY && env.ORDER_EMAIL && env.EMAIL_FROM) {
    ctx.waitUntil(sendOrderEmails(env, {
      orderNumber: claimed.order_number,
      createdAt: claimed.created_at,
      customerName: claimed.customer_name,
      customerPhone: claimed.customer_phone,
      customerEmail: claimed.customer_email || "",
      pickupDate: claimed.pickup_date,
      pickupWindow: claimed.pickup_window,
      notes: claimed.notes || "",
      subtotal: claimed.subtotal_cents,
      bottleCount: claimed.bottle_count,
      items: safeParseItems(claimed.items_json),
      paymentStatus,
      receiptUrl: payment.receipt_url || null
    }));
  }

  return json({ok: true, paymentStatus, receiptUrl: payment.receipt_url || null});
}

async function markPaymentFailed(env, order) {
  await env.DB.prepare(`
    UPDATE orders SET payment_status = 'FAILED', payment_updated_at = ?
    WHERE id = ? AND payment_attempt = ?
  `).bind(new Date().toISOString(), order.id, order.payment_attempt).run();
}

function friendlySquareError(errors) {
  const code = errors?.[0]?.code || "";
  const messages = {
    CARD_DECLINED: "That card was declined. Please try another card or contact your bank.",
    CVV_FAILURE: "The security code did not match. Please check it and try again.",
    ADDRESS_VERIFICATION_FAILURE: "The billing ZIP code did not match. Please check it and try again.",
    INVALID_EXPIRATION: "The expiration date is invalid. Please check it and try again.",
    INSUFFICIENT_FUNDS: "That card has insufficient funds. Please try another card.",
    GENERIC_DECLINE: "That card was declined. Please try another card or contact your bank.",
    CARD_TOKEN_EXPIRED: "The secure card session expired. Please enter the card again."
  };
  return messages[code] || "Square could not complete the payment. Please check the card details or try another card.";
}

function withPaymentSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
    "frame-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
    "connect-src 'self' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://o160250.ingest.sentry.io",
    "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com",
    "font-src 'self' data: https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; "));
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

async function sendOrderEmails(env, order) {
  const siteUrl = env.PUBLIC_SITE_URL || "https://rallypointrefreshments.com";
  const adminUrl = `${siteUrl.replace(/\/$/, "")}/admin`;
  const total = `$${(order.subtotal / 100).toFixed(2)}`;
  const pickupLabel = order.pickupWindow === DEFAULT_PICKUP_WINDOW
    ? `${order.pickupDate} — exact details confirmed by text`
    : `${order.pickupDate} — ${order.pickupWindow}`;

  const addonLabel = item => {
    const cents = BONUS_PRICE_BY_PACK.get(Number(item.bonus));
    return cents ? `pack add-on · $${(cents / 100).toFixed(2).replace(".00", "")}` : "";
  };

  const itemText = order.items.map(item => {
    if (item.type === "single") {
      const label = addonLabel(item);
      return `${item.qty}x ${item.name}${label ? ` (${label})` : ""}`;
    }
    return `${item.size}-Pack:\n${item.flavors.map(flavor => `- ${flavor}`).join("\n")}`;
  }).join("\n\n");

  const itemHtml = order.items.map(item => {
    if (item.type === "single") {
      const label = addonLabel(item);
      const tag = label
        ? ` <span style="color:#17734c;font-size:12px;font-weight:700">${escapeHtml(label)}</span>`
        : "";
      return `<li style="margin:0 0 8px"><strong>${item.qty}×</strong> ${escapeHtml(item.name)}${tag}</li>`;
    }

    const flavorCounts = item.flavors.reduce((result, flavor) => {
      result[flavor] = (result[flavor] || 0) + 1;
      return result;
    }, {});

    const flavors = Object.entries(flavorCounts)
      .map(([name, count]) => `<li>${count}× ${escapeHtml(name)}</li>`)
      .join("");

    return `
      <li style="margin:0 0 12px">
        <strong>Custom ${item.size}-Pack</strong>
        <ul style="margin:6px 0 0;padding-left:20px">${flavors}</ul>
      </li>
    `;
  }).join("");

  const businessText = [
    `New Rally Point order ${order.orderNumber}`,
    "",
    `Customer: ${order.customerName}`,
    `Phone: ${order.customerPhone}`,
    order.customerEmail ? `Email: ${order.customerEmail}` : "",
    `Pickup: ${pickupLabel}`,
    `Bottles: ${order.bottleCount}`,
    `Total: ${total}`,
    "Payment: Paid online by card through Square",
    order.receiptUrl ? `Square receipt: ${order.receiptUrl}` : "",
    "",
    itemText,
    "",
    order.notes ? `Notes: ${order.notes}` : "No notes",
    "",
    `Manage order: ${adminUrl}`
  ].filter(Boolean).join("\n");

  const businessHtml = emailShell(`
    <p style="margin:0 0 6px;color:#c8212c;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">
      New order
    </p>
    <h1 style="margin:0 0 20px;color:#06182f;font-size:28px">${escapeHtml(order.orderNumber)}</h1>

    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:7px 0;color:#6b7280">Customer</td><td style="padding:7px 0;text-align:right;font-weight:700">${escapeHtml(order.customerName)}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Phone</td><td style="padding:7px 0;text-align:right;font-weight:700">${escapeHtml(order.customerPhone)}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Pickup</td><td style="padding:7px 0;text-align:right;font-weight:700">${escapeHtml(pickupLabel)}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Bottles</td><td style="padding:7px 0;text-align:right;font-weight:700">${order.bottleCount}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Total</td><td style="padding:7px 0;text-align:right;font-size:20px;font-weight:800">${total}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Payment</td><td style="padding:7px 0;text-align:right;color:#17734c;font-weight:800">Paid online</td></tr>
    </table>

    <div style="padding:16px;border-radius:12px;background:#f5ecdd">
      <strong style="color:#06182f">Order</strong>
      <ul style="margin:10px 0 0;padding-left:20px">${itemHtml}</ul>
    </div>

    <p style="margin:18px 0;color:#4b5563"><strong>Notes:</strong> ${escapeHtml(order.notes || "No notes")}</p>

    ${order.receiptUrl ? `
      <p style="margin:0 0 18px;color:#4b5563">Square receipt: <a href="${escapeHtml(order.receiptUrl)}">View receipt</a></p>
    ` : ""}

    <a href="${adminUrl}" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#06182f;color:#ffffff;font-weight:800;text-decoration:none">
      Open order dashboard
    </a>
  `);

  const sends = [
    resend(env, {
      to: [env.ORDER_EMAIL],
      subject: `New order ${order.orderNumber} — ${total}`,
      text: businessText,
      html: businessHtml,
      replyTo: order.customerEmail || undefined,
      idempotencyKey: `${order.orderNumber}-business`
    })
  ];

  if (order.customerEmail) {
    const customerText = [
      `Thanks for ordering from Rally Point Refreshments.`,
      "",
      `Confirmation: ${order.orderNumber}`,
      `Pickup: ${pickupLabel}`,
      `Paid online: ${total}`,
      order.receiptUrl ? `Square receipt: ${order.receiptUrl}` : "",
      "",
      itemText,
      "",
      "We saved your order and will contact you with the exact pickup details.",
      `Questions? Text us at (252) 226-0557.`
    ].filter(Boolean).join("\n");

    const customerHtml = emailShell(`
      <p style="margin:0 0 6px;color:#c8212c;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">
        Order confirmed
      </p>
      <h1 style="margin:0 0 10px;color:#06182f;font-size:30px">Thanks, ${escapeHtml(order.customerName)}.</h1>
      <p style="margin:0 0 20px;color:#4b5563">Your bottled coffee order is saved.</p>

      <div style="margin-bottom:18px;padding:18px;border-radius:14px;background:#f5ecdd;text-align:center">
        <span style="display:block;color:#6b7280;font-size:12px;text-transform:uppercase">Confirmation number</span>
        <strong style="display:block;margin-top:4px;color:#c8212c;font-size:23px">${escapeHtml(order.orderNumber)}</strong>
      </div>

      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:7px 0;color:#6b7280">Pickup</td><td style="padding:7px 0;text-align:right;font-weight:700">${escapeHtml(pickupLabel)}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7280">Paid online</td><td style="padding:7px 0;text-align:right;color:#17734c;font-size:20px;font-weight:800">${total}</td></tr>
      </table>

      <div style="padding:16px;border:1px solid #e7dac8;border-radius:12px">
        <strong style="color:#06182f">Your order</strong>
        <ul style="margin:10px 0 0;padding-left:20px">${itemHtml}</ul>
      </div>

      ${order.receiptUrl ? `
        <div style="margin-top:20px;text-align:center">
          <a href="${escapeHtml(order.receiptUrl)}" style="display:inline-block;padding:13px 22px;border-radius:10px;border:2px solid #06182f;color:#06182f;font-weight:800;text-decoration:none">
            View Square receipt
          </a>
        </div>
      ` : ""}

      <p style="margin:20px 0 0;color:#4b5563">
        We will contact you with the exact pickup details. Questions?
        <a href="sms:+12522260557" style="color:#c8212c;font-weight:800">Text (252) 226-0557</a>.
      </p>
    `);

    sends.push(resend(env, {
      to: [order.customerEmail],
      subject: `Rally Point order confirmation ${order.orderNumber}`,
      text: customerText,
      html: customerHtml,
      replyTo: env.ORDER_EMAIL,
      idempotencyKey: `${order.orderNumber}-customer`
    }));
  }

  await Promise.allSettled(sends);
}

function emailShell(content) {
  return `<!doctype html>
  <html>
    <body style="margin:0;padding:0;background:#f5efe6;font-family:Arial,Helvetica,sans-serif;color:#172033">
      <div style="padding:24px 12px">
        <div style="max-width:620px;margin:0 auto;overflow:hidden;border:1px solid #e7dac8;border-radius:18px;background:#fffaf2">
          <div style="padding:18px 22px;background:#06182f;color:#ffffff">
            <strong style="font-size:19px">Rally Point Refreshments</strong>
            <span style="display:block;margin-top:3px;color:#dce5ef;font-size:12px">Veteran-owned bottled coffee</span>
          </div>
          <div style="padding:24px 22px">${content}</div>
        </div>
      </div>
    </body>
  </html>`;
}

async function resend(env, {to, subject, text, html, replyTo, idempotencyKey}) {
  const payload = {
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html
  };

  if (replyTo) payload.reply_to = replyTo;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.error("Resend email failed", response.status, await response.text());
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeOrderNumber(createdAt) {
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  const random = crypto.randomUUID().replaceAll("-", "").slice(0, 5).toUpperCase();
  return `RP-${date}-${random}`;
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeParseItems(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
