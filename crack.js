async function checkDbStatus() {
	const statusEl = document.getElementById("db-status");

	if (!statusEl) {
		return;
	}

	try {
		const response = await fetch("/api/health");
		const data = await response.json();

		if (!response.ok) {
			throw new Error(data.message || "Server responded with an error.");
		}

		statusEl.textContent = data.message;
		statusEl.style.color = data.mongoConnected ? "#1a7f37" : "#b54708";
	} catch (error) {
		statusEl.textContent = "Unable to reach backend. Start server.js on your VPS.";
		statusEl.style.color = "#b42318";
		console.error(error);
	}
}

checkDbStatus();

const playBtn = document.getElementById("play-btn");
const leaderboardBtn = document.getElementById("leaderboard-btn");
const authBtn = document.getElementById("auth-btn");
const settingsBtn = document.getElementById("settings-btn");

if (playBtn) {
	playBtn.addEventListener("click", () => {
		window.location.href = "/play.html";
	});
}

if (leaderboardBtn) {
	leaderboardBtn.addEventListener("click", () => {
		window.location.href = "/leaderboard.html";
	});
}

if (authBtn) {
	authBtn.addEventListener("click", () => {
		window.location.href = "/?forceAuth=1";
	});
}

if (settingsBtn) {
	settingsBtn.addEventListener("click", () => {
		window.location.href = "/settings.html";
	});
}
