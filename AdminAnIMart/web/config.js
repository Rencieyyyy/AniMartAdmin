SUPABASE_URL = "https://kzhlhrhhfupgvpzjllce.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGxocmhoZnVwZ3ZwempsbGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTg5MzcsImV4cCI6MjA5Njg3NDkzN30.asNT0AIXPO_cXKDK_YLV9wozWnCHlg9Bb1L8pMNAPxM"

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);


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

} else {

    // ── PROTECTED PAGES ──
    // Defense-in-depth: a signed-out or non-admin session that lands on any
    // admin page directly is signed out and bounced back to the login screen.

    document.addEventListener("DOMContentLoaded", async () => {

        const { data: { user } } = await supabaseClient.auth.getUser();

        if(!user){
            window.location.replace("../index.html");
            return;
        }

        const admin = await getAdminForCurrentUser();

        if(!admin){
            await supabaseClient.auth.signOut();
            window.location.replace("../index.html?denied=1");
        }

    });

}