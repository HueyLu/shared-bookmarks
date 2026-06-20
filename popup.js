// =============================================================
//  CONFIG — paste these two values from your Firebase project.
//  (Project settings → General → "Web API Key" and "Project ID")
// =============================================================
const PROJECT_ID = "bookmarktwin";
const API_KEY = "AIzaSyAeazXZlFDdq9KEB5fD2ASzAxFwB9JXvlM";
// =============================================================

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const POLL_MS = 4000;

let room = null;
let userName = null;
let pollTimer = null;

// ---- elements ----
const el = (id) => document.getElementById(id);
const setupView = el("setup");
const boardView = el("board");
const configWarn = el("configWarn");
const statusEl = el("status");
const listEl = el("list");
const roomPill = el("roomPill");

// ---- helpers ----
function configured() {
  return PROJECT_ID !== "YOUR_PROJECT_ID" && API_KEY !== "YOUR_WEB_API_KEY";
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!isError);
}

// A stable color per person, so you can scan who added what.
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 45%)`;
}

function collectionUrl() {
  return `${BASE}/rooms/${encodeURIComponent(room)}/bookmarks?key=${API_KEY}`;
}
function docUrl(id) {
  return `${BASE}/rooms/${encodeURIComponent(room)}/bookmarks/${id}?key=${API_KEY}`;
}

function parseDoc(doc) {
  const f = doc.fields || {};
  return {
    id: doc.name.split("/").pop(),
    url: f.url?.stringValue || "",
    title: f.title?.stringValue || "(untitled)",
    addedBy: f.addedBy?.stringValue || "someone",
    createdAt: f.createdAt?.timestampValue || doc.createTime || "",
  };
}

function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}

// ---- Firestore operations ----
async function loadBookmarks() {
  try {
    const res = await fetch(collectionUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = (data.documents || []).map(parseDoc);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    render(items);
    setStatus(items.length ? "" : "");
    chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  } catch (err) {
    setStatus("Couldn't reach the room. Check your config or connection.", true);
  }
}

async function addCurrentTab() {
  el("addBtn").disabled = true;
  setStatus("Adding…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || tab.url.startsWith("chrome")) {
      setStatus("Can't bookmark this page.", true);
      return;
    }
    // Drops it into your "📚 Shared Bookmarks" folder; the background worker
    // then shares it with the room — same path as bookmarking it yourself.
    await chrome.runtime.sendMessage({
      type: "addToShared",
      url: tab.url,
      title: tab.title || tab.url,
    });
    setStatus("");
    setTimeout(loadBookmarks, 800);
  } catch (err) {
    setStatus("Couldn't add that page.", true);
  } finally {
    el("addBtn").disabled = false;
  }
}

async function removeBookmark(id) {
  try {
    await fetch(docUrl(id), { method: "DELETE" });
    await loadBookmarks();
  } catch {
    setStatus("Couldn't remove that one.", true);
  }
}

// ---- rendering ----
function render(items) {
  listEl.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "Nothing shared yet. Save a page into your 📚 Shared Bookmarks folder (or tap the button above) and the group will see it.";
    listEl.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "bm";
    li.style.setProperty("--bar", colorFor(it.addedBy));

    const img = document.createElement("img");
    img.src = faviconFor(it.url);
    img.alt = "";

    const body = document.createElement("div");
    body.className = "body";
    const a = document.createElement("a");
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = it.title;
    const by = document.createElement("div");
    by.className = "by";
    by.textContent = `added by ${it.addedBy}`;
    body.append(a, by);

    const del = document.createElement("button");
    del.className = "del";
    del.title = "Remove";
    del.textContent = "×";
    del.addEventListener("click", () => removeBookmark(it.id));

    li.append(img, body, del);
    listEl.appendChild(li);
  }
}

// ---- view switching ----
function showBoard() {
  setupView.classList.add("hidden");
  boardView.classList.remove("hidden");
  roomPill.classList.remove("hidden");
  roomPill.textContent = room;
  el("whoLabel").textContent = userName;
  loadBookmarks();
  pollTimer = setInterval(loadBookmarks, POLL_MS);
}

function showSetup() {
  if (pollTimer) clearInterval(pollTimer);
  boardView.classList.add("hidden");
  roomPill.classList.add("hidden");
  setupView.classList.remove("hidden");
  el("nameInput").value = userName || "";
  el("roomInput").value = "";
}

// ---- events ----
el("joinBtn").addEventListener("click", async () => {
  const name = el("nameInput").value.trim();
  const code = el("roomInput").value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!name || !code) {
    setStatus("Enter both a name and a room code.", true);
    return;
  }
  userName = name;
  room = code;
  await chrome.storage.sync.set({ userName, room });
  showBoard();
});

el("addBtn").addEventListener("click", addCurrentTab);

el("leaveBtn").addEventListener("click", async () => {
  await chrome.storage.sync.remove("room");
  room = null;
  showSetup();
});

// ---- init ----
(async function init() {
  if (!configured()) {
    setupView.classList.add("hidden");
    configWarn.classList.remove("hidden");
    return;
  }
  // Share config with the background worker so it can sync while the popup is closed.
  await chrome.storage.sync.set({ projectId: PROJECT_ID, apiKey: API_KEY });
  const stored = await chrome.storage.sync.get(["userName", "room"]);
  userName = stored.userName || null;
  room = stored.room || null;
  if (room && userName) showBoard();
  else showSetup();
})();
