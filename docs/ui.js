// js/ui.js
export function updateStatusDisplay(gameState) {
  document.getElementById('levelDisplay').textContent = gameState.level;
  document.getElementById('healthDisplay').textContent = Math.max(0, gameState.health);
  document.getElementById('maxHealthDisplay').textContent = gameState.maxHealth;
  document.getElementById('healthBar').style.width =
    `${Math.max(0, gameState.health)/gameState.maxHealth*100}%`;
  document.getElementById('attackDisplay').textContent = gameState.attack;
  document.getElementById('shieldDisplay').textContent = gameState.shield;
  document.getElementById('scoreValue').textContent = gameState.score;
  document.getElementById('goalValue').textContent = gameState.levelGoal;
  document.getElementById('correctCount').textContent =
    gameState.correctAnswers % gameState.questionsNeededForUpgrade;
}
