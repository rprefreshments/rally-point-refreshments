const CATALOG = new Map([
  ["Brown Sugar Cinnamon Latte", 600],
  ["Gourmet Sea Salt Caramel Latte", 600],
  ["Midnight Mocha Latte", 600],
  ["Double Vanilla Bean Oatmilk Latte", 600],
  ["Copycat Blondie Latte", 600],
  ["Sweet & Salty Hazelnut Latte", 600],
  ["White Chocolate Mocha Latte", 600]
]);

const ALLOWED_WINDOWS = new Set(["Morning", "Afternoon", "Evening"]);
const ALLOWED_STATUSES = new Set(["new", "confirmed", "preparing", "ready", "picked_up", "cancelled"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/orders" && request.method === "POST") {
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

async function ensureDatabase(env) {
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
        status TEXT NOT NULL DEFAULT 'new'
      )
    `),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`)
  ]);
}

async function createOrder(request, env, ctx) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 50_000) return json({ok: false, error: "Order request is too large."}, 413);

  const body = await request.json().catch(() => null);
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
  const pickupWindow = clean(body.pickupWindow, 20);
  const notes = clean(body.notes, 500);

  if (customerName.length < 2) return json({ok: false, error: "Please enter your name."}, 400);
  if (customerPhone.replace(/\D/g, "").length < 10) {
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
      items: parsed.items
    }));
  }

  return json({
    ok: true,
    orderNumber,
    subtotal: parsed.subtotal,
    bottleCount: parsed.bottleCount,
    pickupDate,
    pickupWindow
  }, 201);
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return {ok: false, error: "Your cart is empty or too large."};
  }

  let subtotal = 0;
  let bottleCount = 0;
  const normalized = [];

  for (const item of items) {
    if (!item || typeof item !== "object") return {ok: false, error: "An order item is invalid."};

    if (item.type === "single") {
      const name = clean(item.name, 100);
      const qty = Number(item.qty);

      if (!CATALOG.has(name) || !Number.isInteger(qty) || qty < 1 || qty > 24) {
        return {ok: false, error: "A single-bottle item is invalid."};
      }

      subtotal += CATALOG.get(name) * qty;
      bottleCount += qty;
      normalized.push({type: "single", name, qty});
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
      normalized.push({type: "pack", size, flavors});
      continue;
    }

    return {ok: false, error: "An order item type is invalid."};
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

async function sendOrderEmails(env, order) {
  const itemText = order.items.map(item => {
    if (item.type === "single") return `${item.qty}x ${item.name}`;
    return `${item.size}-Pack:\n${item.flavors.map(flavor => `- ${flavor}`).join("\n")}`;
  }).join("\n\n");

  const businessText = [
    `New Rally Point order ${order.orderNumber}`,
    "",
    `Customer: ${order.customerName}`,
    `Phone: ${order.customerPhone}`,
    order.customerEmail ? `Email: ${order.customerEmail}` : "",
    `Pickup: ${order.pickupDate} — ${order.pickupWindow}`,
    `Bottles: ${order.bottleCount}`,
    `Total: $${(order.subtotal / 100).toFixed(2)}`,
    "",
    itemText,
    "",
    order.notes ? `Notes: ${order.notes}` : "No notes"
  ].filter(Boolean).join("\n");

  const sends = [
    resend(env, {
      to: [env.ORDER_EMAIL],
      subject: `New order ${order.orderNumber} — $${(order.subtotal / 100).toFixed(2)}`,
      text: businessText,
      idempotencyKey: `${order.orderNumber}-business`
    })
  ];

  if (order.customerEmail) {
    const customerText = [
      `Thanks for ordering from Rally Point Refreshments.`,
      "",
      `Confirmation: ${order.orderNumber}`,
      `Pickup: ${order.pickupDate} — ${order.pickupWindow}`,
      `Total due at pickup: $${(order.subtotal / 100).toFixed(2)}`,
      "",
      itemText,
      "",
      "We will contact you with the exact pickup details."
    ].join("\n");

    sends.push(resend(env, {
      to: [order.customerEmail],
      subject: `Rally Point order confirmation ${order.orderNumber}`,
      text: customerText,
      idempotencyKey: `${order.orderNumber}-customer`
    }));
  }

  await Promise.allSettled(sends);
}

async function resend(env, {to, subject, text, idempotencyKey}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject,
      text
    })
  });

  if (!response.ok) {
    console.error("Resend email failed", response.status, await response.text());
  }
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
