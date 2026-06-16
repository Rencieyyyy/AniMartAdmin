// storage.js — Supabase Storage helpers for the AniMart admin panel.
//
// No build step: this file is loaded globally from a <script> tag AFTER
// config.js (which defines the global `supabaseClient`) and relies on the
// global `showToast(msg, isError)` defined by the page scripts.
//
// Images live in Supabase Storage (object storage). The database stores only
// the file's public URL — never the image bytes.


// Allowed image types and per-bucket size caps (mirror the bucket config SQL).
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;    // 2 MB
const LISTING_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB


// Lowercase file extension for a File, falling back to its MIME type.
function fileExt(file) {
    const fromName = (file.name.split(".").pop() || "").toLowerCase();
    if (fromName && fromName.length <= 5 && fromName !== file.name.toLowerCase()) {
        return fromName;
    }
    const byMime = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
    };
    return byMime[file.type] || "bin";
}


// Validate a File client-side. Returns null when OK, else an error message.
function validateImageFile(file, maxBytes) {
    if (!file) return "No file selected.";
    if (!IMAGE_MIME_TYPES.includes(file.type)) {
        return "Please choose an image file (JPG, PNG, WEBP or GIF).";
    }
    if (file.size > maxBytes) {
        const mb = Math.round(maxBytes / (1024 * 1024));
        return `Image is too large. Please choose one under ${mb}MB.`;
    }
    return null;
}


// Upload a File to `bucket` at `path` and return its public URL.
// Throws on failure so callers can surface context via showToast.
async function uploadToBucket(bucket, path, file, { upsert = true } = {}) {
    const { error: uploadError } = await supabaseClient
        .storage
        .from(bucket)
        .upload(path, file, {
            upsert,
            contentType: file.type,
            cacheControl: "3600"
        });

    if (uploadError) throw uploadError;

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}


// ── AVATARS ──
// Stable per-user path so a re-upload overwrites the previous picture.
async function uploadAvatar(userId, file) {
    const path = `${userId}/avatar.${fileExt(file)}`;
    return uploadToBucket("avatar", path, file, { upsert: true });
}


// ── LISTING IMAGES ──
// Namespaced by seller + listing; supports multiple images per listing.
// Returns an array of public URLs in the same order as `files`.
async function uploadListingImages(sellerId, listingId, files) {
    const urls = [];
    let i = 0;
    for (const file of files) {
        const err = validateImageFile(file, LISTING_MAX_BYTES);
        if (err) throw new Error(err);
        const path = `${sellerId}/${listingId}/${Date.now()}_${i}.${fileExt(file)}`;
        urls.push(await uploadToBucket("listings", path, file, { upsert: true }));
        i++;
    }
    return urls;
}
