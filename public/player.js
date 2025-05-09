// player.js

export function createPlayer(canvas, gameState) {
  const p = {
    x: canvas.width/2 - 25,
    y: canvas.height - 80,
    width: 50,
    height: 60,
    speed: 5,
    shootCooldown: 0,
    shootInterval: 500,
    moveLeft: false,
    moveRight: false,
    moveUp: false,
    moveDown: false,
    type: gameState.character,
    invulnerable: false,
    invulnerableTime: 0,
    attackRadius: 20,
  };
  p.baseSpeed = p.speed;
  p.baseShootInterval = p.shootInterval;
  return p;
}

// 更新函式：多帶入 isTouching, touchX, touchY
export function updatePlayer(
  player, deltaTime, canvas,
  joystickInput, isTouching, touchX, touchY,
  shootFn
) {
  // 1. 無敵計時
  if (player.invulnerable) {
    player.invulnerableTime -= deltaTime;
    if (player.invulnerableTime <= 0) player.invulnerable = false;
  }

  // 2. 如果搖桿有輸入，就優先用向量移動
  if (joystickInput && (joystickInput.x !== 0 || joystickInput.y !== 0)) {
    player.x += joystickInput.x * player.speed * (deltaTime/16);
    player.y += joystickInput.y * player.speed * (deltaTime/16);
  }
  // 3. 否則如果是在觸控狀態，就用「插值追蹤」觸控點
  else if (isTouching) {
    const targetX = touchX - player.width/2;
    const targetY = touchY - player.height/2;
    // 插值平滑移動
    player.x += (targetX - player.x) * 0.3;
    player.y += (targetY - player.y) * 0.3;
  }
  // 4. 再保留鍵盤移動（可選）
  else {
    if (player.moveLeft  && player.x > 0)                             player.x -= player.speed * (deltaTime/16);
    if (player.moveRight && player.x < canvas.width-player.width)     player.x += player.speed * (deltaTime/16);
    if (player.moveUp    && player.y > 0)                             player.y -= player.speed * (deltaTime/16);
    if (player.moveDown  && player.y < canvas.height-player.height)   player.y += player.speed * (deltaTime/16);
  }

  // 5. 邊界檢查
  player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));

  // 6. 自動射擊
  player.shootCooldown -= deltaTime;
  if (player.shootCooldown <= 0) {
    shootFn();
    player.shootCooldown = player.shootInterval;
  }
}
