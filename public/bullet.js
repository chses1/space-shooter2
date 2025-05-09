export function shoot(player, bullets, attackRadius) {
  const bulletWidth = 5;
  const bulletHeight = 15;
  bullets.push({
      x: player.x + player.width / 2 - bulletWidth / 2,
      y: player.y,
      width: bulletWidth,
      height: bulletHeight,
      speed: 10,
      damage: 10,
      color: '#fff',
      // 新增子彈屬性 (例如，子彈大小與範圍相關)
      radius: attackRadius,
  });
}

export function updateBullets(bullets, deltaTime) {
  for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i];
      bullet.y -= bullet.speed * (deltaTime / 16);
      if (bullet.y < 0) {
          bullets.splice(i, 1);
      }
  }
}