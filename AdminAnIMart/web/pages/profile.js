
let toastTimer;

function showToast(message, isError = false){

    const toast = document.getElementById("toast");
    const toastMsg = document.getElementById("toastMsg");
    const dot = toast.querySelector(".toast-dot");


    toastMsg.innerText = message;


    if (dot) {
        dot.style.background = isError ? "var(--danger)" : "var(--mint)";
        dot.style.boxShadow = isError ? "0 0 8px var(--danger)" : "0 0 8px var(--mint)";
    }


    toast.classList.add("show");



    clearTimeout(toastTimer);

    toastTimer = setTimeout(()=>{

        toast.classList.remove("show");

    },3000);


}


document.addEventListener(
    "DOMContentLoaded",
    loadAdminProfile
);


// Password fields the "Update Password" button submits.
const PASSWORD_FIELDS = ["currentPwd", "newPwd", "confirmPwd"];


// Grey out / disable the Update Password button until the admin types something.
function updatePasswordButtonState() {
    const btn = document.getElementById("updatePasswordBtn");
    if (!btn) return;

    const hasInput = PASSWORD_FIELDS.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "";
    });

    btn.disabled = !hasInput;
    btn.classList.toggle("disabled", !hasInput);
}


document.addEventListener("DOMContentLoaded", () => {
    PASSWORD_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", updatePasswordButtonState);
    });
    updatePasswordButtonState();
});



let currentAdminID = null;


// Fields that the "Save Changes" button persists. Used to detect whether
// the admin actually changed anything before enabling the button.
const PROFILE_FIELDS = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "location",
    "myMessengerLink"
];

let originalProfile = {};
let changeListenersBound = false;


// Compare the current input values against the values last loaded from the DB.
// A queued (but not-yet-saved) profile picture also counts as a change so the
// Save button enables even when only the picture was changed.
function hasProfileChanges() {
    if (window.pendingAvatarFile) return true;
    return PROFILE_FIELDS.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== (originalProfile[id] ?? "");
    });
}


// Grey out / disable the Save button when nothing has changed.
function updateSaveButtonState() {
    const btn = document.getElementById("savePersonalBtn");
    if (!btn) return;

    const changed = hasProfileChanges();
    btn.disabled = !changed;
    btn.classList.toggle("disabled", !changed);
}


// Snapshot the freshly loaded values and start watching for edits.
function initProfileChangeTracking() {
    PROFILE_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) originalProfile[id] = el.value;
    });

    if (!changeListenersBound) {
        PROFILE_FIELDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("input", updateSaveButtonState);
        });
        changeListenersBound = true;
    }

    updateSaveButtonState();
}




async function loadAdminProfile() {


    // Discard any queued-but-unsaved profile picture (e.g. after a Reset/reload).
    window.pendingAvatarFile = null;


    const { data: { user }, error } =
        await supabaseClient.auth.getUser();



    if (error) {

        console.error("AUTH ERROR:", error);
        showToast("Auth error: " + error.message, true);
        return;

    }



    if (!user) {


        window.location.href = "../index.html";

        return;

    }



    const { data, error: dbError } =

        await supabaseClient

            .from("admins")

            .select("*")

            .eq("email", user.email)

            .maybeSingle();





    if (dbError) {

        // Surface the real reason instead of a generic message:
        //  - "JSON object requested, multiple (or no) rows returned" => no admin row for this email
        //  - RLS / permission errors will show the policy message here
        console.error("DATABASE ERROR:", dbError);
        showToast("DB error (" + (dbError.code || "?") + "): " + dbError.message, true);
        return;

    }



    if (!data) {

        console.error("No admin row found for:", user.email);
        showToast("No admin record found for " + user.email, true);
        return;

    }






    currentAdminID = data.id;





    // LEFT SIDE


    document.getElementById("sidebarName").innerText =

        data.first_name + " " + data.last_name;



    document.getElementById("sidebarEmail").innerText =

        data.email;



    document.getElementById("sidebarPhone").innerText =

        data.phone;



    document.getElementById("sidebarLocation").innerText =

        data.location;



    document.getElementById("sidebarCreated").innerText =

        new Date(data.created_at)
            .toLocaleDateString();
    // Profile picture: show the saved image if present, else fall back to initials.
    const avatarEl = document.getElementById("avatarDisplay");

    if (data.pfp) {

        avatarEl.innerHTML =
            `<img src="${escapeHtml(data.pfp)}" alt="Profile picture" ` +
            `style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;

    } else {

        avatarEl.innerText = data.first_name[0] + data.last_name[0];

    }

    // RIGHT SIDE
    document.getElementById("firstName").value =

        data.first_name;



    document.getElementById("lastName").value =

        data.last_name;



    document.getElementById("email").value =

        data.email;



    document.getElementById("phone").value =

        data.phone;



    document.getElementById("location").value =

        data.location;




    // MESSENGER


    document.getElementById("myMessengerLink").value =

        data.messenger;



    document.getElementById("messengerPreviewBtn").href =

        data.messenger;


    // Snapshot loaded values + disable Save until something changes.
    initProfileChangeTracking();

}









async function savePersonalInfo(){


    // Get current logged user
    const { data:{user}, error:userError } = 
    await supabaseClient.auth.getUser();


    if(userError || !user){

        showToast("User session expired");
        return;

    }



    const updateData = {


        first_name:
        document.getElementById("firstName").value,


        last_name:
        document.getElementById("lastName").value,


        email:
        document.getElementById("email").value,


        phone:
        document.getElementById("phone").value,


        location:
        document.getElementById("location").value,


        messenger:
        document.getElementById("myMessengerLink").value


    };





    const {data,error}=await supabaseClient


    .from("admins")


    .update(updateData)


    .eq("email", user.email)


    .select();



    if(error){


        showToast("Error updating profile.");


        return;


    }





    if(!data || data.length === 0){


        showToast("No row updated.");

        return;


    }


    // If a profile picture was queued via the avatar picker, upload + persist it
    // now as part of the same save. saveProfilePicture handles its own toast and
    // updates admins.pfp; we clear the queue so it isn't re-uploaded.
    if(window.pendingAvatarFile){

        const fileToUpload = window.pendingAvatarFile;
        window.pendingAvatarFile = null;

        await saveProfilePicture(fileToUpload);

    } else {

        showToast("Profile updated successfully");

    }



    loadAdminProfile();


}






function resetPersonalInfo() {

    loadAdminProfile();

}




// ── PROFILE PICTURE ──
// Uploads the selected image to the `avatar` Storage bucket and stores only
// its public URL in admins.pfp (no base64 in the database).
async function saveProfilePicture(file){


    // Re-validate on the JS side (type + 2MB cap) before uploading.
    const validationError = validateImageFile(file, 2 * 1024 * 1024);
    if(validationError){

        showToast(validationError, true);
        return;

    }


    const { data:{ user }, error:userError } =
        await supabaseClient.auth.getUser();


    if(userError || !user){

        showToast("User session expired. Please log in again.", true);
        return;

    }


    // Upload to avatar/<uid>/avatar.<ext> (upsert overwrites the old picture).
    let publicUrl;

    try {

        publicUrl = await uploadAvatar(user.id, file);

    } catch (e) {

        console.error("AVATAR UPLOAD ERROR:", e);
        showToast("Error uploading profile picture: " + (e.message || e), true);
        return;

    }


    // The Storage path is stable (upsert overwrites the old file), so the public
    // URL never changes between uploads. With cacheControl=3600 the browser would
    // keep showing the previously cached image after a reload. Bake a version
    // query (?t=) into the persisted URL so every new upload yields a distinct URL
    // — fresh image after reload, while unchanged avatars still cache normally.
    const versionedUrl = `${publicUrl}?t=${Date.now()}`;

    // Persist only the URL.
    const { data, error } = await supabaseClient

        .from("admins")

        .update({ pfp: versionedUrl })

        .eq("email", user.email)

        .select();


    if(error){

        console.error("SAVE PFP DB ERROR:", error);
        showToast("Error saving profile picture (" + (error.code || "?") + "): " + error.message, true);
        return;

    }


    if(!data || data.length === 0){

        showToast("No row updated.", true);
        return;

    }


    // Show the freshly uploaded image immediately using the same versioned URL
    // that was just persisted, so the in-session view matches what a reload loads.
    const avatarEl = document.getElementById("avatarDisplay");

    avatarEl.innerHTML =
        `<img src="${versionedUrl}" alt="Profile picture" ` +
        `style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;


    showToast("Profile picture updated successfully");

}




async function savePassword(){


    const cur = document.getElementById("currentPwd").value;
    const nw  = document.getElementById("newPwd").value;
    const cf  = document.getElementById("confirmPwd").value;


    // Validation
    if(!cur){
        showToast("Please enter your current password.", true);
        return;
    }

    if(nw.length < 8){
        showToast("New password must be at least 8 characters.", true);
        return;
    }

    if(nw !== cf){
        showToast("Passwords do not match. Please enter the correct password.", true);
        return;
    }

    if(nw === cur){
        showToast("New password must be different from the current one.", true);
        return;
    }


    // Make sure we have a logged-in user
    const { data:{ user }, error:userError } =
        await supabaseClient.auth.getUser();

    if(userError || !user){
        showToast("User session expired. Please log in again.", true);
        return;
    }


    // Verify the current password by re-authenticating
    const { error:signInError } =
        await supabaseClient.auth.signInWithPassword({
            email: user.email,
            password: cur
        });

    if(signInError){
        showToast("Incorrect password. Your current password is not correct.", true);
        return;
    }


    // Update to the new password
    const { error:updateError } =
        await supabaseClient.auth.updateUser({
            password: nw
        });

    if(updateError){
        showToast("Error updating password: " + updateError.message, true);
        return;
    }


    clearPasswords();
    showToast("Password updated successfully!");

}