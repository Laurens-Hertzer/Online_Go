const API_BASE_URL = window.location.origin;

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById('auth-form');
    const registerForm = document.getElementById("register-form");

    if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
            e.preventDefault();

            const username = document.getElementById("username-login").value;
            const password = document.getElementById("password-login").value;

            fetch(`${API_BASE_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password })
            })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || "Login fehlgeschlagen");
                }
                return res.json();
            })
            .then(() => {
                window.location.href = "lobby.html";
            })
            .catch(err => alert(err.message));
        });
    }

    if (registerForm) {
        registerForm.addEventListener("submit", (e) => {
            e.preventDefault();

            const username = document.getElementById("username-register").value;
            const password = document.getElementById("password-register").value;

            fetch(`${API_BASE_URL}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ username, password })
            })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || "Registrierung fehlgeschlagen");
                }
                return res.json();
            })
            .then(data => {
                alert(data.message);
                // Optional: Auto-Login nach Registrierung
            })
            .catch(err => alert(err.message));
        });
    }
});
