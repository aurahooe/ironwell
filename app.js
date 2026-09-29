const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const authBtn = $("authBtn");
const authPanel = $("authPanel");
const deskPanel = $("deskPanel");
const wallSection = $("wallSection");
const authMsg = $("authMsg");

let session = null;
let profile = null;

function hourKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day}-${h}`;
}

function msToNextHour() {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 0, 0, 0
  ));
  return next - now;
}

function fmtRemain(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

function setView(name) {
  authPanel.classList.toggle("hidden", name !== "auth");
  deskPanel.classList.toggle("hidden", name !== "desk");
  wallSection.classList.toggle("hidden", name === "auth");
}

function renderUser() {
  if (session) {
    authBtn.textContent = "Sign out";
    $("deskBtn").disabled = false;
  } else {
    authBtn.textContent = "Sign in";
    $("deskBtn").disabled = false;
  }
}

async function ensureProfile() {
  if (!session) return;
  const { data } = await sb.from("ironwell_profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (data) {
    profile = data;
    return;
  }
  const handleRaw = ($("handle").value || session.user.email.split("@")[0]).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24) || "hand";
  const handle = handleRaw.toLowerCase();
  const { data: created, error } = await sb.from("ironwell_profiles").insert({
    id: session.user.id,
    handle,
    display_name: handle
  }).select().single();
  if (!error) profile = created;
}

async function loadFeatured() {
  const key = hourKey();
  $("hourLabel").textContent = `Hour ${key.split("-").pop()} UTC`;
  const { data: hour } = await sb.from("ironwell_hours").select("slip_id").eq("hour_key", key).maybeSingle();
  let slipId = hour?.slip_id;
  if (!slipId) {
    const { data: latest } = await sb.from("ironwell_hours").select("slip_id").order("started_at", { ascending: false }).limit(1);
    slipId = latest?.[0]?.slip_id;
  }
  if (!slipId) {
    $("featuredBody").textContent = "The well is quiet. Public slips rise here when someone marks them open.";
    $("featuredBy").textContent = "";
    return;
  }
  const { data: slip } = await sb.from("ironwell_slips").select("body, author_id, ironwell_profiles(handle, display_name)").eq("id", slipId).maybeSingle();
  if (!slip) return;
  $("featuredBody").textContent = slip.body;
  const who = slip.ironwell_profiles;
  $("featuredBy").textContent = who ? `— ${who.display_name || who.handle}` : "";
}

async function rotateHourIfNeeded() {
  const key = hourKey();
  const { data: existing } = await sb.from("ironwell_hours").select("id").eq("hour_key", key).maybeSingle();
  if (existing) return;
  const { data: publics } = await sb.from("ironwell_slips").select("id").eq("is_public", true).order("created_at", { ascending: false }).limit(24);
  if (!publics?.length) return;
  const pick = publics[Math.floor(Math.random() * publics.length)];
  await sb.from("ironwell_hours").insert({ slip_id: pick.id, hour_key: key });
}

async function loadWall() {
  const { data } = await sb
    .from("ironwell_slips")
    .select("id, body, created_at, ironwell_profiles(handle, display_name)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(60);
  const wall = $("wall");
  wall.innerHTML = "";
  (data || []).forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "card";
    li.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
    const who = row.ironwell_profiles;
    li.innerHTML = `<p>${escapeHtml(row.body)}</p><div class="meta"><span>${who ? "@" + who.handle : ""}</span><span>${new Date(row.created_at).toLocaleString()}</span></div>`;
    wall.appendChild(li);
  });
}

async function loadMine() {
  if (!session) {
    $("mine").innerHTML = "";
    return;
  }
  const { data } = await sb
    .from("ironwell_slips")
    .select("id, body, is_public, created_at")
    .eq("author_id", session.user.id)
    .order("created_at", { ascending: false });
  const mine = $("mine");
  mine.innerHTML = "";
  (data || []).forEach((row) => {
    const li = document.createElement("li");
    li.className = "card";
    li.innerHTML = `<p>${escapeHtml(row.body)}</p>
      <div class="meta">
        <span>${row.is_public ? "public" : "private"}</span>
        <span class="actions">
          <button type="button" data-id="${row.id}" data-act="toggle">${row.is_public ? "Make private" : "Make public"}</button>
          <button type="button" data-id="${row.id}" data-act="del">Burn</button>
        </span>
      </div>`;
    mine.appendChild(li);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("wallBtn").onclick = () => setView("wall");
$("deskBtn").onclick = async () => {
  if (!session) {
    setView("auth");
    return;
  }
  setView("desk");
  await loadMine();
};
authBtn.onclick = async () => {
  if (session) {
    await sb.auth.signOut();
    session = null;
    profile = null;
    renderUser();
    setView("wall");
    return;
  }
  setView("auth");
};

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  authMsg.textContent = "Sending…";
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  authMsg.textContent = error ? error.message : "Check your mail. The link brings you back here.";
};

$("slipForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!session) return setView("auth");
  await ensureProfile();
  if (!profile) {
    authMsg.textContent = "Could not open a desk for you.";
    setView("auth");
    return;
  }
  const body = $("body").value.trim();
  const is_public = $("isPublic").checked;
  const { error } = await sb.from("ironwell_slips").insert({
    author_id: session.user.id,
    body,
    is_public
  });
  if (error) {
    alert(error.message);
    return;
  }
  $("body").value = "";
  $("isPublic").checked = false;
  await loadMine();
  await loadWall();
  await rotateHourIfNeeded();
  await loadFeatured();
};

$("mine").onclick = async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "del") {
    await sb.from("ironwell_slips").delete().eq("id", id);
  } else {
    const { data } = await sb.from("ironwell_slips").select("is_public").eq("id", id).single();
    await sb.from("ironwell_slips").update({ is_public: !data.is_public }).eq("id", id);
  }
  await loadMine();
  await loadWall();
  await loadFeatured();
};

function tickClock() {
  $("countdown").textContent = fmtRemain(msToNextHour());
}

async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session) await ensureProfile();
  renderUser();
  await rotateHourIfNeeded();
  await loadFeatured();
  await loadWall();
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(async () => {
    await rotateHourIfNeeded();
    await loadFeatured();
    await loadWall();
  }, 60 * 1000);
}

sb.auth.onAuthStateChange(async (_e, s) => {
  session = s;
  if (session) await ensureProfile();
  renderUser();
  if (session) {
    setView("desk");
    await loadMine();
  }
});

boot();
