SUPABASE_URL = "https://kzhlhrhhfupgvpzjllce.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGxocmhoZnVwZ3ZwempsbGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTg5MzcsImV4cCI6MjA5Njg3NDkzN30.asNT0AIXPO_cXKDK_YLV9wozWnCHlg9Bb1L8pMNAPxM"


// ── "Remember me" ──
// supabase-js keeps the session in localStorage (survives closing the
// browser). When the user UNchecks "Remember me" at login we set this flag
// and route the session through sessionStorage instead, so it dies with the
// browser. The flag itself lives in localStorage so every page (and tab)
// agrees on where to look. Absent flag = remember (matches old behaviour).
const REMEMBER_FLAG = "animart_remember_me";

const authStorage = {
    _store() {
        return localStorage.getItem(REMEMBER_FLAG) === "no" ? sessionStorage : localStorage;
    },
    getItem(key)        { return authStorage._store().getItem(key); },
    setItem(key, value) { authStorage._store().setItem(key, value); },
    removeItem(key)     { localStorage.removeItem(key); sessionStorage.removeItem(key); }
};

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth: { storage: authStorage } }
);


// ── Idle-session timeout ──
// An abandoned admin tab full of user PII should not stay signed in forever.
// Any activity (mouse, keys, scroll, touch) refreshes a shared timestamp in
// localStorage (shared so several tabs count as one session); after
// IDLE_TIMEOUT_MS with no activity in ANY tab, the session is signed out and
// the user is bounced to the login page with a friendly message.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes
const IDLE_STAMP_KEY  = "animart_last_activity";

function stampActivity() {
    localStorage.setItem(IDLE_STAMP_KEY, String(Date.now()));
}

function idleExpired() {
    const last = Number(localStorage.getItem(IDLE_STAMP_KEY) || 0);
    return last > 0 && (Date.now() - last) > IDLE_TIMEOUT_MS;
}

async function enforceIdleTimeout() {
    if (!idleExpired()) return false;
    localStorage.removeItem(IDLE_STAMP_KEY);
    await supabaseClient.auth.signOut();
    window.location.replace(pathToLogin() + "?timeout=1");
    return true;
}

// Login page lives one level above /pages/.
function pathToLogin() {
    return /\/pages\//.test(window.location.pathname) ? "../index.html" : "index.html";
}


// Formal message shown when a valid Supabase account that is NOT an admin tries
// to enter the portal (either at login or by navigating directly to a page).
const ACCESS_DENIED_MESSAGE =
    "Access denied. This account does not have permission to access the AniMart admin portal.";


// Looks up the admins row for the currently signed-in user.
// Returns the row, or null when there is no session, the account is not an
// admin, or the admin has been BLOCKED by a super admin (blocked accounts
// also lose all database access via RLS — this check is just the front door).
async function getAdminForCurrentUser(){

    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user) return null;

    const { data } = await supabaseClient
        .from("admins")
        .select("id, email, role, status")
        .eq("email", user.email)
        .maybeSingle();

    if (!data || data.status === "blocked") return null;
    return data;
}


function denyAccess(){
    if (typeof showLoginError === "function") {
        showLoginError(ACCESS_DENIED_MESSAGE);
    } else {
        alert(ACCESS_DENIED_MESSAGE);
    }
}


const loginForm = document.getElementById("loginForm");


if (loginForm) {

    // ── LOGIN PAGE ──

    loginForm.addEventListener("submit", async function(e){

        e.preventDefault(); // STOP page refresh


        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;

        // Decide where the session will live BEFORE signing in (see
        // REMEMBER_FLAG above). Missing checkbox = remember, old behaviour.
        const rememberBox = document.getElementById("rememberMe");
        localStorage.setItem(REMEMBER_FLAG, rememberBox && !rememberBox.checked ? "no" : "yes");


        const { error } = await supabaseClient.auth.signInWithPassword({

            email: email,
            password: password

        });


        if(error){

            // Bad email/password — Supabase returns "Invalid login credentials".
            console.log(error);
            if (typeof showLoginError === "function") {
                showLoginError("Wrong email or password. Please check your credentials and try again.");
            } else {
                alert("Wrong email or password. Please check your credentials and try again.");
            }
            return;

        }


        // Auth succeeded, but a valid Supabase user is not necessarily an admin.
        // Require a matching admins row before granting access; otherwise revoke
        // the session we just created and deny entry.
        const admin = await getAdminForCurrentUser();

        if(!admin){

            await supabaseClient.auth.signOut();
            denyAccess();
            return;

        }


        // Admin confirmed → enter the dashboard.
        stampActivity();
        const loginBtn = document.getElementById("loginBtn");

        loginBtn.innerText = "Authenticating...";
        loginBtn.style.opacity = "0.7";
        loginBtn.style.cursor = "not-allowed";


        setTimeout(()=>{

            window.location.href="pages/dashboard.html";

        },1000);

    });


    // If a protected page bounced a non-admin back here, surface the message.
    const params = new URLSearchParams(window.location.search);
    if (params.get("denied") === "1") {
        denyAccess();
    }
    if (params.get("timeout") === "1" && typeof showLoginError === "function") {
        showLoginError("You were signed out after 30 minutes of inactivity. Please sign in again.");
    }

} else {

    // ── PROTECTED PAGES ──
    // Defense-in-depth: a signed-out or non-admin session that lands on any
    // admin page directly is signed out and bounced back to the login screen.

    // Snapshot BEFORE the first stampActivity() below overwrites the stored
    // timestamp — this is what catches "tab reopened hours later".
    const idleAtLoad = idleExpired();

    document.addEventListener("DOMContentLoaded", async () => {

        const { data: { user } } = await supabaseClient.auth.getUser();

        if(!user){
            window.location.replace("../index.html");
            return;
        }

        // Session exists but sat idle past the limit (e.g. tab reopened
        // hours later) → end it before any data loads.
        if (idleAtLoad) {
            localStorage.removeItem(IDLE_STAMP_KEY);
            await supabaseClient.auth.signOut();
            window.location.replace("../index.html?timeout=1");
            return;
        }

        const admin = await getAdminForCurrentUser();

        if(!admin){
            await supabaseClient.auth.signOut();
            window.location.replace("../index.html?denied=1");
        }

    });

    // Activity tracking + periodic idle check (only on protected pages —
    // the login page has nothing to time out).
    if (!idleAtLoad) stampActivity();
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart"].forEach(evt =>
        window.addEventListener(evt, throttleStamp, { passive: true }));

    let lastStampWrite = 0;
    function throttleStamp() {
        const now = Date.now();
        if (now - lastStampWrite > 30 * 1000) {   // write at most every 30s
            lastStampWrite = now;
            stampActivity();
        }
    }

    setInterval(enforceIdleTimeout, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) enforceIdleTimeout();
    });

}