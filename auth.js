const signInTab = document.getElementById("show-signin");
const signUpTab = document.getElementById("show-signup");
const signInForm = document.getElementById("signin-form");
const signUpForm = document.getElementById("signup-form");
const authMessage = document.getElementById("auth-message");
const HOME_PAGE = "/home.html";
const urlParams = new URLSearchParams(window.location.search);
const forceAuth = urlParams.get("forceAuth") === "1";

try {
    const storedUser = localStorage.getItem("trivcrackUser");

    if (storedUser && !forceAuth) {
        const parsedUser = JSON.parse(storedUser);

        if (parsedUser && parsedUser.email) {
            window.location.replace(HOME_PAGE);
        }
    }
} catch (error) {
    localStorage.removeItem("trivcrackUser");
}

function setMessage(message, isError = false) {
    authMessage.textContent = message;
    authMessage.style.color = isError ? "#b42318" : "#1a7f37";
}

function showSignIn() {
    signInForm.classList.remove("hidden");
    signUpForm.classList.add("hidden");
    signInTab.classList.add("active");
    signUpTab.classList.remove("active");
    setMessage("");
}

function showSignUp() {
    signUpForm.classList.remove("hidden");
    signInForm.classList.add("hidden");
    signUpTab.classList.add("active");
    signInTab.classList.remove("active");
    setMessage("");
}

signInTab.addEventListener("click", showSignIn);
signUpTab.addEventListener("click", showSignUp);

signUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
        username: document.getElementById("signup-username").value,
        email: document.getElementById("signup-email").value,
        password: document.getElementById("signup-password").value
    };

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Unable to create account.");
        }

        setMessage("Account created successfully. Please sign in.");
        signUpForm.reset();
        showSignIn();
    } catch (error) {
        setMessage(error.message, true);
    }
});

signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
        email: document.getElementById("signin-email").value,
        password: document.getElementById("signin-password").value
    };

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || "Unable to sign in.");
        }

        localStorage.setItem("trivcrackUser", JSON.stringify(data.user));
        setMessage(`Signed in as ${data.user.username}. Redirecting...`);
        signInForm.reset();
        window.location.assign(HOME_PAGE);
    } catch (error) {
        setMessage(error.message, true);
    }
});
