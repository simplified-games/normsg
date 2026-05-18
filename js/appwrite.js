// ── APPWRITE CONFIG ────────────────────────────────────────
// Replace these three values with your own from cloud.appwrite.io
const AW_ENDPOINT   = 'https://syd.cloud.appwrite.io/v1';
const AW_PROJECT_ID = 'normsg';   // ← Project Settings → Project ID
const AW_DB_ID      = 'normsg-db';  // ← Databases → your DB → Database ID

// Salt used to derive per-user Appwrite passwords from Firebase UIDs.
// Change this to any long random string — keep it secret and never change it after launch.
const AW_APP_SECRET = 'normsg-2025-change-me-to-something-random';

// ── SDK INIT ───────────────────────────────────────────────
// Explicitly expose these to the window object so auth.js, statuses.js, etc. can use them!
window.awClient    = new Appwrite.Client().setEndpoint(AW_ENDPOINT).setProject(AW_PROJECT_ID);
window.awDatabases = new Appwrite.Databases(window.awClient);
window.awAccount   = new Appwrite.Account(window.awClient);

// Expose utilities that your scripts require
window.Query       = Appwrite.Query;
window.ID          = Appwrite.ID;

// Expose config constants in case other files reference them
window.AW_DB_ID    = AW_DB_ID;

// ── AUTH BRIDGE ────────────────────────────────────────────
// Called once after Firebase login. Creates (or logs into) a matching
// Appwrite account so we can use Appwrite's database with per-user auth.
// The Appwrite credentials are derived deterministically from the Firebase UID.
async function awEnsureSession(firebaseUid) {
    const email = `${firebaseUid}@normsg.aw`;
    const pass  = `${firebaseUid}-${AW_APP_SECRET}`;
    try {
        await awAccount.get(); // already has a valid session
    } catch {
        try {
            await awAccount.createEmailPasswordSession(email, pass);
        } catch (e) {
            // Session creation failed — account probably doesn't exist yet
            if (e.code === 401 || (e.message && e.message.includes('Invalid'))) {
                try {
                    await awAccount.create(firebaseUid, email, pass);
                    await awAccount.createEmailPasswordSession(email, pass);
                } catch (createErr) {
                    console.warn('Appwrite account setup error:', createErr);
                }
            }
        }
    }
}

// ── TIMESTAMP HELPER ──────────────────────────────────────
// Returns current time as ISO string (replaces Firestore SV() / serverTimestamp)
function awNow() { return new Date().toISOString(); }

// Converts an Appwrite ISO string to a Date (replaces .toDate() on Firestore Timestamps)
function awDate(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? null : d;
}

// ── JSON ENCODE / DECODE ──────────────────────────────────
// Appwrite doesn't support nested objects — complex values are stored as JSON strings.
// Used for: reactions, replyTo, votes, views, normsgSuper, normsgUltra, normTokens, etc.
function awEncode(obj) {
    if (obj == null) return null;
    try { return JSON.stringify(obj); } catch { return null; }
}
function awDecode(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
}

// ── USER DOC DECODER ──────────────────────────────────────
// Decodes the JSON string fields on a user document and wraps timestamps
// so the rest of the codebase can call .toDate() as before.
function awDecodeUser(doc) {
    if (!doc) return null;
    const wrap = (iso) => iso ? { toDate: () => new Date(iso), seconds: Math.floor(new Date(iso) / 1000) } : null;
    return {
        ...doc,
        normsgSuper:  awDecode(doc.normsgSuper),
        normsgUltra:  awDecode(doc.normsgUltra),
        normTokens:   awDecode(doc.normTokens),
        pfpChanges:   awDecode(doc.pfpChanges) || [],
        nameChanges:  awDecode(doc.nameChanges) || [],
        lastSeen:     wrap(doc.lastSeen),
        timeoutUntil: wrap(doc.timeoutUntil),
    };
}

// ── CRUD HELPERS ──────────────────────────────────────────

// Get a single document (throws if not found — use try/catch to check existence)
async function awGet(collection, docId) {
    return await awDatabases.getDocument(AW_DB_ID, collection, docId);
}

// Create a document with an auto-generated ID
async function awAdd(collection, data) {
    return await awDatabases.createDocument(AW_DB_ID, collection, ID.unique(), data);
}

// Update an existing document (partial update — only provided fields change)
async function awUpdate(collection, docId, data) {
    return await awDatabases.updateDocument(AW_DB_ID, collection, docId, data);
}

// Create-or-update (like Firestore set with merge:true)
async function awUpsert(collection, docId, data) {
    try {
        return await awDatabases.updateDocument(AW_DB_ID, collection, docId, data);
    } catch (e) {
        if (e.code === 404) {
            return await awDatabases.createDocument(AW_DB_ID, collection, docId, data);
        }
        throw e;
    }
}

// Delete a document (silent if already gone)
async function awDelete(collection, docId) {
    try {
        return await awDatabases.deleteDocument(AW_DB_ID, collection, docId);
    } catch (e) {
        if (e.code !== 404) throw e;
    }
}

// Query — returns array of documents
async function awList(collection, queries = []) {
    const res = await awDatabases.listDocuments(AW_DB_ID, collection, queries);
    return res.documents;
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────
// Wraps Appwrite Realtime. Returns an unsubscribe function.
// collectionIds: array of collection IDs to subscribe to (e.g. ['messages', 'groups'])
function awSubscribe(collectionIds, callback) {
    const channels = collectionIds.map(c =>
        `databases.${AW_DB_ID}.collections.${c}.documents`
    );
    return awClient.subscribe(channels, callback);
}
