SUPABASE_URL = "https://kzhlhrhhfupgvpzjllce.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6aGxocmhoZnVwZ3ZwempsbGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTg5MzcsImV4cCI6MjA5Njg3NDkzN30.asNT0AIXPO_cXKDK_YLV9wozWnCHlg9Bb1L8pMNAPxM"

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);


const loginForm = document.getElementById("loginForm");

if (loginForm) loginForm.addEventListener("submit", async function(e){

    e.preventDefault(); // STOP page refresh


    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;


    const { data, error } = await supabaseClient.auth.signInWithPassword({

        email: email,
        password: password

    });


    if(error){

        // Show the styled wrong-credentials popup with the usual message.
        // Supabase returns "Invalid login credentials" for a bad email/password.
        console.log(error);
        if (typeof showLoginError === "function") {
            showLoginError("Wrong email or password. Please check your credentials and try again.");
        } else {
            alert("Wrong email or password. Please check your credentials and try again.");
        }

    }else{


        const loginBtn = document.getElementById("loginBtn");


        loginBtn.innerText = "Authenticating...";
        loginBtn.style.opacity = "0.7";
        loginBtn.style.cursor = "not-allowed";


        setTimeout(()=>{

            window.location.href="pages/dashboard.html";

        },1000);


    }


});