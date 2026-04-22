async function updateLeaderboard() {
    try{
        const response = await fetch('/api/leaderboard');
        const data = await response.json();
        const tbody = document.getElementById('leaderboard-body');
        tbody.innerHTML = '';
        data.forEach((entry, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${entry.player}</td>
                <td>${entry.score}</td>
            `;
            tbody.appendChild(row);
        });
    if(data.length === 0){
            tbody.innerHTML = '<tr><td colspan="3">No data available</td></tr>';
    }
    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="3">Error loading leaderboard</td></tr>';
    }
    

}
updateLeaderboard();

async function sendScoreToLeaderboard(playerName, score) {
    try {
        await fetch('/api/leaderboard', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ player: playerName, score })
        });
    }catch (error) {
        console.error('Error sending score to server:', error);
    }
}
