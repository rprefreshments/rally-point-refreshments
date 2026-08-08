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
        square_payment_link TEXT
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

  schemaReady = true;
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitState = new Map();

function isRateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (rateLimitState.size > 10_000) rateLimitState.clear();

  const timestamps = (rateLimitState.get(ip) || []).filter(ts => ts > windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitState.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  rateLimitState.set(ip, timestamps);
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
  let orderNumber = "";
  let inserted = false;

  for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
    orderNumber = makeOrderNumber(createdAt);

    try {
      await env.DB.prepare(`
        INSERT INTO orders (
          order_number, created_at, customer_name, customer_phone, customer_email,
          pickup_date, pickup_window, notes, subtotal_cents, bottle_count, items_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
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
        JSON.stringify(parsed.items)
      ).run();
      inserted = true;
    } catch (error) {
      if (!String(error.message || error).toLowerCase().includes("unique")) throw error;
    }
  }

  if (!inserted) throw new Error("Could not create a unique order number.");

  const squarePaymentLink = await createSquarePaymentLink(env, orderNumber, parsed.subtotal);

  if (squarePaymentLink) {
    await env.DB.prepare(`UPDATE orders SET square_payment_link = ? WHERE order_number = ?`)
      .bind(squarePaymentLink, orderNumber)
      .run();
  }

  if (env.RESEND_API_KEY && env.ORDER_EMAIL && env.EMAIL_FROM) {
    ctx.waitUntil(sendOrderEmails(env, {
      orderNumber,
      createdAt,
      customerName,
      customerPhone,
      customerEmail,
      pickupDate,
      pickupWindow,
      notes,
      subtotal: parsed.subtotal,
      bottleCount: parsed.bottleCount,
      items: parsed.items,
      squarePaymentLink
    }));
  }

  return json({
    ok: true,
    orderNumber,
    subtotal: parsed.subtotal,
    bottleCount: parsed.bottleCount,
    pickupDate,
    pickupWindow,
    squarePaymentLink
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

async function createSquarePaymentLink(env, orderNumber, subtotalCents) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) return null;

  const base = env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

  try {
    const response = await fetch(`${base}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2024-10-17"
      },
      body: JSON.stringify({
        idempotency_key: `${orderNumber}-square`,
        quick_pay: {
          name: `Rally Point order ${orderNumber}`,
          price_money: {amount: subtotalCents, currency: "USD"},
          location_id: env.SQUARE_LOCATION_ID
        }
      })
    });

    if (!response.ok) {
      console.error("Square payment link failed", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data.payment_link?.url || null;
  } catch (error) {
    console.error("Square payment link request failed", error);
    return null;
  }
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
    order.squarePaymentLink ? `Prepay link sent to customer: ${order.squarePaymentLink}` : "",
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
    </table>

    <div style="padding:16px;border-radius:12px;background:#f5ecdd">
      <strong style="color:#06182f">Order</strong>
      <ul style="margin:10px 0 0;padding-left:20px">${itemHtml}</ul>
    </div>

    <p style="margin:18px 0;color:#4b5563"><strong>Notes:</strong> ${escapeHtml(order.notes || "No notes")}</p>

    ${order.squarePaymentLink ? `
      <p style="margin:0 0 18px;color:#4b5563">Prepay link sent to the customer: <a href="${escapeHtml(order.squarePaymentLink)}">${escapeHtml(order.squarePaymentLink)}</a></p>
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
      `Total due at pickup: ${total}`,
      order.squarePaymentLink ? `Prefer to pay now instead? ${order.squarePaymentLink}` : "",
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
        <tr><td style="padding:7px 0;color:#6b7280">Total due at pickup</td><td style="padding:7px 0;text-align:right;font-size:20px;font-weight:800">${total}</td></tr>
      </table>

      <div style="padding:16px;border:1px solid #e7dac8;border-radius:12px">
        <strong style="color:#06182f">Your order</strong>
        <ul style="margin:10px 0 0;padding-left:20px">${itemHtml}</ul>
      </div>

      ${order.squarePaymentLink ? `
        <div style="margin-top:20px;text-align:center">
          <a href="${escapeHtml(order.squarePaymentLink)}" style="display:inline-block;padding:13px 22px;border-radius:10px;border:2px solid #06182f;color:#06182f;font-weight:800;text-decoration:none">
            Pay now with card
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
