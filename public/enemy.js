// 新增一個常數來表示特殊敵人類型
const SPECIAL_ENEMY_TYPE = 3; // 假設我們有 0, 1, 2 三種基本敵人
// enemy.js
export function enemyShoot(enemy, enemyBullets) {
    const bulletWidth = 4;
    const bulletHeight = 10;
    enemyBullets.push({
      x: enemy.x + enemy.width / 2 - bulletWidth / 2,
      y: enemy.y + enemy.height,
      width: bulletWidth,
      height: bulletHeight,
      speed: 5,
      damage: 10,
      color: enemy.type === 0
        ? '#ef4444'
        : enemy.type === 1
          ? '#f59e0b'
          : '#8b5cf6'
    });
  }
  
  export function spawnEnemy(canvas, gameState, enemies) {
    const enemyWidth  = 40;
    const enemyHeight = 40;
    const enemyY = -enemyHeight;
  
    // 先決定敵人種類
    let enemyType = Math.floor(Math.random() * 3);
    if (Math.random() < 0.05) {
      enemyType = SPECIAL_ENEMY_TYPE;
    }
  
    // 如果是特殊敵人，從「固定幾個點」中隨機選一；否則隨機 X 座標
    let enemyX;
    if (enemyType === SPECIAL_ENEMY_TYPE) {
      // 這裡舉例放在畫面 20%、50%、80% 三個位置
      const fixedPositions = [
        canvas.width * 0.2 - enemyWidth / 2,
        canvas.width * 0.5 - enemyWidth / 2,
        canvas.width * 0.8 - enemyWidth / 2
      ];
      enemyX = fixedPositions[Math.floor(Math.random() * fixedPositions.length)];
    } else {
      enemyX = Math.random() * (canvas.width - enemyWidth);
    }
  
    // 按照既有邏輯計算其他屬性
    const enemyHealth   = 20 + (gameState.level - 1) * 10;
    const enemySpeed    = 2  + (gameState.level - 1) * 0.3;
    const enemyPoints   = 10 + (gameState.level - 1) * 5;
    const shootCooldown = Math.random() * 2000 + 1000;
    const shootInterval = Math.random() * 2000 + 2000 - (gameState.level - 1) * 200;
  
    enemies.push({
      x: enemyX,
      y: enemyY,
      width: enemyWidth,
      height: enemyHeight,
      health: enemyHealth,
      maxHealth: enemyHealth,
      speed: enemySpeed,
      type: enemyType,
      points: enemyPoints,
      shootCooldown,
      shootInterval,
      // 特殊敵人不需要左右移動：
      horizontalSpeed: 0,
      horizontalDirection: 0,
      dropPowerup: (enemyType === SPECIAL_ENEMY_TYPE),
    });
  }
  

export function updateEnemies(enemies, deltaTime, canvas, enemyBullets, powerups) { // 增加 powerups 參數
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];

        // 新增：依 speed 與 deltaTime 更新 y 座標，讓敵人往下移動
        e.y += e.speed * (deltaTime / 16);
 
        e.shootCooldown -= deltaTime;
        if (e.shootCooldown <= 0) {
            enemyShoot(e, enemyBullets);
            e.shootCooldown = e.shootInterval;
        }

        if (e.y > canvas.height) {
            enemies.splice(i, 1);
        }

        // 敵人死亡時掉落道具
        if (e.health <= 0) {
            if (e.dropPowerup) {
                dropPowerup(e.x, e.y, powerups); // 生成道具
            }
            enemies.splice(i, 1);
        }
    }
}

export function dropPowerup(x, y, powerups) {
        // 隨機 0~4 共五種道具
        const powerupType = Math.floor(Math.random() * 5);    
    powerups.push({
        x: x,
        y: y,
        type: powerupType,
        width: 24,     // 稍微放大
        height: 24,
        duration: 8000, // 所有道具持續時間改為 8 秒
    });
}