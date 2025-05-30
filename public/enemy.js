// 新增一個常數來表示特殊敵人類型
const SPECIAL_ENEMY_TYPE = 3; // 假設我們有 0, 1, 2 三種基本敵人

// 新增頭目類型常數
export const BOSS_ENEMY_TYPE = 4;

/**
 * 頭目扇形發射：一次發 5 發子彈
 */
export function bossShoot(enemy, enemyBullets) {
  const bulletSize = 8;
  const baseAngle = 90;       // 90° 向下
  const spread = 45;          // 左右各 45°
  const angles = [-spread, -spread/2, 0, spread/2, spread];
  const speed = 4;

  angles.forEach(offset => {
    const rad = (baseAngle + offset) * Math.PI / 180;
    enemyBullets.push({
      x: enemy.x + enemy.width/2 - bulletSize/2,
      y: enemy.y + enemy.height,
      width: bulletSize,
      height: bulletSize,
      vx: Math.cos(rad) * speed,
      vy: Math.sin(rad) * speed,
      damage: 20,
      color: '#FFD700'
    });
  });
}

/**
 * 在關卡 5 的倍數呼叫：產生頭目
 */
export function spawnBoss(canvas, gameState, enemies) {
  const bossW = 120, bossH = 120;
  const bossX = canvas.width/2 - bossW/2;
  const bossY = 20;
  // 依照現有等級計算基本血量，並 x5
  const baseHp = 20 + (gameState.level - 1) * 20;
  const bossHp  = baseHp * 5;

  enemies.push({
    x: bossX,
    y: bossY,
    width: bossW,
    height: bossH,
    health: bossHp,
    maxHealth: bossHp,
    type: BOSS_ENEMY_TYPE,
    points: gameState.level * 100,  // 擊殺得分 = 等級×100
    shootInterval: 2000,
    shootCooldown: 2000,
    horizontalSpeed: 2 + (gameState.level - 1) * 0.2,
    horizontalDirection: 1,
    dropPowerup: false
  });
}


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
    // 每關開始時初始化：記錄關卡啟動時間與初始化 lastAssaultTime
    if (gameState.levelStartLevel !== gameState.level) {
      gameState.levelStartLevel = gameState.level;
      gameState.levelStartTime = Date.now();
      // 每關開始時初始化 lastAssaultTime
      gameState.lastAssaultTime = gameState.levelStartTime;
    }

    const enemyWidth  = 40;
    const enemyHeight = 40;
    const enemyY = -enemyHeight;
  
   // ★ 如果是 5 的倍數關卡，且本關尚未 spawn 過頭目，就生出一次
  if (gameState.level % 5 === 0 && !gameState.bossSpawned) {
    spawnBoss(canvas, gameState, enemies);
    gameState.bossSpawned = true;   // 標記：本關已經生過頭目
    return;                          // 跳過產生一般小怪
  }
    
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
    const enemyHealth   = 20 + (gameState.level - 1) * 20;
    const enemySpeed    = 2  + (gameState.level - 1) * 0.3;
    const enemyPoints   = 10 + (gameState.level - 1) * 5;
    const shootCooldown = Math.random() * 2000 + 1000;
    const shootInterval = Math.random() * 1500 + 1500 - (gameState.level - 1) * 300;

    // 每 30 秒觸發突擊隊群體生成：倒三角形隊形，共 6 隻，速度為一般敵人的兩倍
    const now = Date.now();
    if (now - gameState.lastAssaultTime >= 30000) {
      gameState.lastAssaultTime = now;
      // 突擊隊只用普通敵人 (0,1,2)
      const assaultType = Math.floor(Math.random() * 3);
      // 增加隊員間隔
      const spacingX = enemyWidth + 40;
      const spacingY = enemyHeight + 40;
      // 以玩家 X 座標對準
      const centerX = gameState.playerX;
      // 倒三角形：3, 2, 1 排列
      [3, 2, 1].forEach((num, rowIndex) => {
        const yPos = enemyY + rowIndex * spacingY;
        for (let j = 0; j < num; j++) {
          const xPos = centerX + (j - (num - 1) / 2) * spacingX;
          enemies.push({
          x: xPos,
          y: yPos,
          width: enemyWidth,
          height: enemyHeight,
          health: enemyHealth,
          maxHealth: enemyHealth,
          speed: enemySpeed * 2,
          horizontalSpeed: 0,
          horizontalDirection: 0,
          type: assaultType,
          points: enemyPoints,
          shootCooldown,
          shootInterval,
          dropPowerup: false,
          assault: true,
        });  
        }
      });
      return;
    }
  
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
      // 特殊敵人水平移動設定
      horizontalSpeed: 1 + (gameState.level - 1) * 0.2,
      horizontalDirection: 1,
      dropPowerup: (enemyType === SPECIAL_ENEMY_TYPE),
    });
  }
  

export function updateEnemies(enemies, deltaTime, canvas, enemyBullets, powerups) { // 增加 powerups 參數
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];

        // 星形特殊敵人：左右閃避+正常下移+射擊
        if (e.type === SPECIAL_ENEMY_TYPE) {
          // 隨機翻轉方向
          if (Math.random() < 0.03) e.horizontalDirection *= -1;
          // 水平閃避
          e.x += e.horizontalSpeed * (deltaTime / 16) * e.horizontalDirection;
          // 確保不超出邊界
          if (e.x <= 0 || e.x + e.width >= canvas.width) {
            e.horizontalDirection *= -1;
          }
          // 向下移動
          e.y += e.speed * (deltaTime / 16);
          // 普通射擊
          e.shootCooldown -= deltaTime;
          if (e.shootCooldown <= 0) {
            enemyShoot(e, enemyBullets);
            e.shootCooldown = e.shootInterval;
          }
          continue;
        }

        // 群體突擊隊成員：斜向落下並射擊
        if (e.assault) {
          // 只做快速垂直下降
          e.y += e.speed * (deltaTime / 16);
          e.shootCooldown -= deltaTime;
          if (e.shootCooldown <= 0) {
            enemyShoot(e, enemyBullets);
            e.shootCooldown = e.shootInterval;
          }
          continue;
        }

        if (e.type === BOSS_ENEMY_TYPE) {
          // 頭目：左右移動，不下降
          e.x += e.horizontalSpeed * (deltaTime/16) * e.horizontalDirection;
          if (e.x <= 0 || e.x + e.width >= canvas.width) {
            e.horizontalDirection *= -1;
          }

          // 頭目發射扇形子彈
          e.shootCooldown -= deltaTime;
          if (e.shootCooldown <= 0) {
            bossShoot(e, enemyBullets);
            e.shootCooldown = e.shootInterval;
          }
        } else {
          // 原本邏輯：往下移動 & 普通射擊
          e.y += e.speed * (deltaTime / 16);
          e.shootCooldown -= deltaTime;
          if (e.shootCooldown <= 0) {
            enemyShoot(e, enemyBullets);
            e.shootCooldown = e.shootInterval;
          }
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