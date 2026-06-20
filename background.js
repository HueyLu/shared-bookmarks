// Two-way sync between the shared room and a real "📚 Shared Bookmarks" folder.
//  - You save/drag a bookmark INTO the folder  -> pushed to the room (shared)
//  - Someone else shares one                   -> mirrored into your folder
//  - You remove one from the folder            -> removed from the room
// Bookmarks anywhere ELSE in your browser are never touched.

const ALARM = "sync-shared-bookmarks";
const FOLDER_TITLE = "📚 Shared Bookmarks";
const inFlight = new Set(); // guards same-tick duplicate pushes

chrome.runtime.onInstalled.addListener(() =>
  chrome.alarms.create(ALARM, { periodInMinutes: 1 })
);
chrome.runtime.onStartup.addListener(() =>
  chrome.alarms.create(ALARM, { periodInMinutes: 1 })
);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) syncNow();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "sync") syncNow();
  if (msg?.type === "addToShared") addToShared(msg.url, msg.title);
});

// ---- react to the user's own bookmarking, but only inside the shared folder ----
chrome.bookmarks.onCreated.addListener(async (id, node) => {
  if (!node.url) return;
  if (node.parentId === (await getOrCreateFolder())) pushUrl(node.url, node.title);
});

chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  const node = removeInfo.node;
  if (!node?.url) return;
  if (node.parentId === (await getOrCreateFolder())) removeUrl(node.url);
});

chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  const folderId = await getOrCreateFolder();
  let node;
  try {
    [node] = await chrome.bookmarks.get(id);
  } catch {
    return;
  }
  if (!node?.url) return;
  if (moveInfo.parentId === folderId && moveInfo.oldParentId !== folderId) {
    pushUrl(node.url, node.title); // dragged into the shared folder
  } else if (moveInfo.oldParentId === folderId && moveInfo.parentId !== folderId) {
    removeUrl(node.url); // dragged out of it
  }
});

// ---- config + room helpers ----
async function getCfg() {
  const c = await chrome.storage.sync.get([
    "projectId",
    "apiKey",
    "room",
    "userName",
  ]);
  if (!c.projectId || !c.apiKey || !c.room) return null;
  c.base =
    `https://firestore.googleapis.com/v1/projects/${c.projectId}` +
    `/databases/(default)/documents/rooms/${encodeURIComponent(c.room)}/bookmarks`;
  return c;
}

async function fetchRoom(cfg) {
  const res = await fetch(`${cfg.base}?key=${cfg.apiKey}`);
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  return (data.documents || []).map((d) => ({
    id: d.name.split("/").pop(),
    url: d.fields?.url?.stringValue || "",
    title: d.fields?.title?.stringValue || "(untitled)",
  }));
}

// ---- local folder -> room ----
async function pushUrl(url, title) {
  if (inFlight.has(url)) return;
  inFlight.add(url);
  try {
    const cfg = await getCfg();
    if (!cfg) return;
    const existing = await fetchRoom(cfg);
    if (existing.some((b) => b.url === url)) return; // already shared, no echo
    await fetch(`${cfg.base}?key=${cfg.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          url: { stringValue: url },
          title: { stringValue: title || url },
          addedBy: { stringValue: cfg.userName || "someone" },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    });
  } catch {
    /* offline — alarm will catch up */
  } finally {
    inFlight.delete(url);
  }
}

async function removeUrl(url) {
  try {
    const cfg = await getCfg();
    if (!cfg) return;
    for (const b of await fetchRoom(cfg)) {
      if (b.url === url) {
        await fetch(`${cfg.base}/${b.id}?key=${cfg.apiKey}`, { method: "DELETE" });
      }
    }
  } catch {}
}

// Used by the popup's "Add this page" button: just drop it in the folder,
// and onCreated above handles the share.
async function addToShared(url, title) {
  if (!url || url.startsWith("chrome")) return;
  const folderId = await getOrCreateFolder();
  const children = await chrome.bookmarks.getChildren(folderId);
  if (children.some((c) => c.url === url)) return;
  await chrome.bookmarks.create({ parentId: folderId, title: title || url, url });
}

// ---- room -> local folder ----
async function syncNow() {
  const cfg = await getCfg();
  if (!cfg) return;
  try {
    const items = (await fetchRoom(cfg)).filter((i) => i.url);
    await mirrorToFolder(items);
  } catch {}
}

async function getOrCreateFolder() {
  const found = await chrome.bookmarks.search({ title: FOLDER_TITLE });
  const folder = found.find((b) => !b.url); // folders have no url
  if (folder) return folder.id;
  const created = await chrome.bookmarks.create({ title: FOLDER_TITLE });
  return created.id;
}

async function mirrorToFolder(items) {
  const uniq = [...new Map(items.map((i) => [i.url, i])).values()];
  const folderId = await getOrCreateFolder();
  const children = await chrome.bookmarks.getChildren(folderId);
  const have = new Set(children.map((c) => c.url));
  const want = new Set(uniq.map((i) => i.url));

  for (const it of uniq) {
    if (!have.has(it.url)) {
      await chrome.bookmarks.create({
        parentId: folderId,
        title: it.title,
        url: it.url,
      });
    }
  }
  for (const c of children) {
    if (c.url && !want.has(c.url)) await chrome.bookmarks.remove(c.id);
  }
}
