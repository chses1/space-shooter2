// main.js 開頭
// 如果前後端同部署在同一個域名，就留空；也可動態抓 window.location.origin
const API_BASE = '';  

// 匯入 UI 與遊戲核心模組
import { updateStatusDisplay } from './ui.js';    // 更新狀態列顯示
import { createPlayer, updatePlayer } from './player.js'; // 玩家邏輯：創建 & 更新
import { spawnEnemy, updateEnemies, dropPowerup, BOSS_ENEMY_TYPE } from './enemy.js';  // 敵人生成 & 更新
import { shoot, updateBullets } from './bullet.js';      // 射擊 & 子彈更新

// 動態載入題庫
let mathQuestions = [];
let unusedQuestions = [];

async function loadQuestions() {
  try {
    const res = await fetch(`${API_BASE}/api/questions`);
    mathQuestions = await res.json();
    unusedQuestions = [...mathQuestions];
    console.log(`✅ 已載入 ${mathQuestions.length} 筆題目`);
  } catch (err) {
    console.error('載入題庫失敗:', err);
  }
}
loadQuestions();



// 全域遊戲狀態，儲存關卡、分數、血量等主要參數
const gameState = {
  studentId: '',            // 學生座號 (登入用)
  character: null,          // 選擇的飛機 ID (char1/char2/char3)
  level: 1,                 // 關卡
  score: 0,                 // 總分
  health: 100,              // 目前血量
  maxHealth: 100,           // 最大血量
  attack: 10,               // 攻擊力
  isPlaying: false,         // 遊戲進行狀態
  levelGoal: 0,             // 過關所需分數
  correctAnswers: 0,        // 已答對題數 (數學挑戰)
  totalQuestions: 0,        // 已答題總數
  totalScoreForLevel: 0,    // 當前關卡累計分數
  questionsNeededForUpgrade: 3, // 升級所需答對題數
  challengeCorrectCount: 0,  // 本次太空站答對題數
  challengeCurrentCount: 0,  // 本次太空站已做題數
  specialAttackReady: true,     // 特殊攻擊是否可用
  specialAttackMaxCooldown: 5000, // 特殊攻擊冷卻(ms)
  specialAttackCooldown: 0,        // 當前冷卻時間
  shield: 0,       // 當前剩餘護盾值
  shieldMax: 0,    // 護盾最大值，用於顯示
  hasAnswered: false,        // 是否已經回答過本題
  bossSpawned: false,    // ★ 新增：本關是否已經出過頭目
};



// 全域變數：canvas, 繪圖上下文、玩家/敵人清單、計時器等
let canvas, ctx;
let player;                        // 玩家物件
let enemies = [], bullets = [], enemyBullets = [], stars = [];
let powerups = []; // 新增道具陣列
let lastTime = 0, enemySpawnTimer = 0;
const enemySpawnInterval = 1500;  // 每1.5秒生成一隻敵人
let gameAnimationId;
let currentQuestion = null;
let timerInterval;
let touchX = 0, touchY = 0, isTouching = false;
// 搖桿輸入向量
let joystickInput = { x: 0, y: 0 };

// 排行榜提示計時器 ID（防止彈窗跳出兩次）
let leaderboardTimeoutId = null;

// 玩家最後移動時間與閒置判斷
let lastMoveTime = Date.now();
const INACTIVITY_LIMIT = 3 * 60 * 1000; // 3分鐘毫秒
let warningIssued = false;
const WARNING_TIME = INACTIVITY_LIMIT - 30 * 1000; // 2分30秒


/**
 * 初始化遊戲：設定 canvas、事件綁定、背景星星...
 */
function initGame() {
  // 1. 取得 canvas 與 2D 繪圖上下文
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  // 2. 自適應視窗大小，並生成星星背景
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // 3. 綁定鍵盤移動事件
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  // 4. 右鍵觸發特殊攻擊、禁用預設選單
  document.addEventListener('mousedown', e => {
    if (e.button === 2 && gameState.isPlaying) useSpecialAttack();
  });
  document.addEventListener('contextmenu', e => e.preventDefault());

  // 5. 空白鍵觸發特殊攻擊
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && gameState.isPlaying) {
      e.preventDefault();
      useSpecialAttack();
    }
  });
  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove',  handleTouchMove);
  canvas.addEventListener('touchend',   handleTouchEnd);

  // 確保題庫已正確載入
  console.log(mathQuestions);



// 綁定平板觸控：觸碰「特殊攻擊按鈕」就觸發
const specialBtn = document.getElementById('specialAttackButton');
specialBtn.addEventListener('touchstart', e => {
  e.preventDefault();           // 阻止預設的滾動或縮放
  if (gameState.isPlaying) {
    useSpecialAttack();         // 呼叫特殊攻擊
  }
});


}
/**
 * 主遊戲循環：更新 & 繪製所有遊戲元素
 * @param {number} timestamp 當前時間戳
 */
function gameLoop(timestamp) {
  const delta = timestamp - lastTime;
  lastTime = timestamp;

  // === 檢查玩家閒置時間 ===
  if (gameState.isPlaying) {
    const now = Date.now();
    const idleTime = now - lastMoveTime;

    if (idleTime > WARNING_TIME && !warningIssued) {
      // 顯示警告，不要中斷計時
      const warnDiv = document.getElementById('inactivityWarning');
      if (warnDiv) warnDiv.classList.remove('hidden');
      warningIssued = true;
    }

    if (idleTime > INACTIVITY_LIMIT) {
      console.log('偵測到長時間未移動，自動結束遊戲');
      // 隱藏警告
      const warnDiv = document.getElementById('inactivityWarning');
      if (warnDiv) warnDiv.classList.add('hidden');
      gameOver();
      return;
    }
  }

  // 清空畫布
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 更新並繪製背景星星
  updateStars(delta);
  drawStars();

  // 定時生成敵人
  enemySpawnTimer += delta;
  if (enemySpawnTimer >= enemySpawnInterval) {
    spawnEnemy(canvas, gameState, enemies);
    enemySpawnTimer = 0;
  }

  // 更新 & 繪製敵人和敵方子彈
  updateEnemies(enemies, delta, canvas, enemyBullets, powerups);
  drawEnemies();
  updateEnemyBullets(delta);
  drawEnemyBullets();

  // 更新 & 繪製玩家角色和玩家子彈
  updatePlayer(
    player,
    delta,
    canvas,
    joystickInput,
    isTouching,    // 觸控旗標
    touchX, touchY,// 觸控座標
    () => shoot(player, bullets, gameState.attack)
  );
  updateBullets(bullets, delta);
  drawBullets();
  drawShield();      // ← 新增：先畫護盾
  drawPlayer();

  // 更新並繪製道具
  updatePowerups(powerups, delta);
  drawPowerups();
  checkPowerupPickup();

  // 碰撞檢查：子彈、敵人、玩家碰撞
  checkCollisions();

  // 更新頁面上的狀態列 (等級、血量、分數、冷卻)
  updateStatusDisplay(gameState);
  // 先更新特殊攻擊冷卻計時
  updateSpecialAttack(delta);
  updateSpecialAttackDisplay();

  // 檢查遊戲結束或關卡完成
  if (gameState.isPlaying) {
    if (gameState.score >= gameState.levelGoal) {
      levelComplete();
    } else if (gameState.health <= 0) {
      gameOver();
    } else {
      gameAnimationId = requestAnimationFrame(gameLoop);
    }
  }
}

function updatePowerups(powerups, deltaTime) {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const powerup = powerups[i];
        powerup.duration -= deltaTime;
        if (powerup.duration <= 0) {
            powerups.splice(i, 1);
        }
        powerup.y += 2; // 道具緩慢下降
    }
}

function drawPowerups() {
  for (const p of powerups) {
    const x = p.x + p.width/2;
    const y = p.y + p.height/2;
    const s = p.width;

    ctx.save();
    ctx.translate(x, y);

    if (p.type === 0) {
      // 範圍：橘色圈
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s/2, 0, Math.PI*2);
      ctx.stroke();
    }
    else if (p.type === 1) {
      // 連發：三顆小子彈
      ctx.fillStyle = '#06b6d4';
      const bw = s/6, bh = s/2;
      ctx.fillRect(-bw - 2, -bh/2, bw, bh);
      ctx.fillRect(-bw/2,     -bh/2, bw, bh);
      ctx.fillRect( bw + 2 - bw, -bh/2, bw, bh);
    }
    else if (p.type === 2) {
      // 補血：綠色十字
      ctx.fillStyle = '#10b981';
      const l = s/2.5;
      ctx.fillRect(-s/10, -l, s/5, 2*l);
      ctx.fillRect(-l,    -s/10, 2*l, s/5);
    }
    else if (p.type === 3) {
      // 無敵盾牌：青藍色盾形
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.moveTo(0, -s/2);
      ctx.lineTo(s/2, -s/6);
      ctx.lineTo(s/6,  s/2);
      ctx.lineTo(-s/6, s/2);
      ctx.lineTo(-s/2, -s/6);
      ctx.closePath();
      ctx.fill();
    }
    else if (p.type === 4) {
      // 速度加成：黃色箭頭
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(0, -s/2);
      ctx.lineTo(s/4, 0);
      ctx.lineTo( s/12, 0);
      ctx.lineTo( s/12, s/2);
      ctx.lineTo(-s/12, s/2);
      ctx.lineTo(-s/12, 0);
      ctx.lineTo(-s/4, 0);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}


function applyPowerupEffect(type) {
  switch (type) {
    case 0: // 特殊攻擊範圍加大：可重複，永久生效（最多疊加5次）
      // 新增疊加次數限制
      if (!gameState.specialAttackStack) gameState.specialAttackStack = 0;
      if (gameState.specialAttackStack < 5) {
        gameState.specialAttackRadius += 50;
        gameState.specialAttackStack++;
        console.log('>> specialAttackRadius:', gameState.specialAttackRadius);
      }
      break;

    case 1: // 連發加速：每次減少射擊間隔 100ms，永久生效（最多疊加5次）
      if (!gameState.shootSpeedupStack) gameState.shootSpeedupStack = 0;
      if (gameState.shootSpeedupStack < 5) {
        player.shootInterval = Math.max(50, player.shootInterval - 100);
        gameState.shootSpeedupStack++;
        console.log('>> shootInterval:', player.shootInterval);
      }
      break;

    case 2: // 補血：一次性
      gameState.health = Math.min(gameState.maxHealth, gameState.health + 30);
      break;

    case 3: // 護盾：給予固定護盾值，吸收傷害直到耗盡或遊戲結束
      gameState.shieldMax = 50;        // 或調整成你想要的護盾量
      gameState.shield = gameState.shieldMax;
      console.log('>> shield:', gameState.shield);
      break;

    case 4: // 速度加成：永久提升移動速度
      player.speed += 3;              // 或調整成你想要的增幅
      console.log('>> speed:', player.speed);
      break;
  }
}


/**
 * 向後端上傳排行榜資料
 */
async function updateLeaderboard() {
  try {
    await fetch(`${API_BASE}/api/leaderboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: gameState.studentId,
        score: gameState.score,
        level: gameState.level
      })
    });
    console.log('✅ 成功送出分數到後端');
  } catch (err) {
    console.error('❌ 送出分數失敗', err);
  }
}

    // 綁定登入按鈕
    document.getElementById('loginBtn').addEventListener('click', handleLogin);

    // 綁定開始遊戲按鈕
    document.getElementById('startGameBtn').addEventListener('click', startGame);

    // 綁定角色選擇
    const characters = document.querySelectorAll('.character');
    characters.forEach(char => {
      char.addEventListener('click', () => {
        characters.forEach(c => c.classList.remove('selected'));
        char.classList.add('selected');
        gameState.character = char.id;
      });
    });
      
      // 排行榜數據
      let leaderboard = JSON.parse(localStorage.getItem('spaceShooterLeaderboard')) || [];
      

      
      // DOM 載入完成後初始化遊戲
      document.addEventListener('DOMContentLoaded', () => {
        initGame();
        document.getElementById('enterStationBtn')
          .addEventListener('click', startMathChallenge);
        document.getElementById('continueBtn')
          .addEventListener('click', startNextLevel);

// 教師後台按鈕：顯示密碼輸入畫面
document.getElementById('teacherButton')
  .addEventListener('click', () => {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('teacherLoginScreen').classList.remove('hidden');
  });

// 「返回」按鈕：從登入後台回主畫面
document.getElementById('teacherLoginBackBtn')
  .addEventListener('click', () => {
    document.getElementById('teacherLoginScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
  });

// 密碼驗證
document.getElementById('teacherLoginBtn')
  .addEventListener('click', () => {
    const pw = document.getElementById('teacherPasswordInput').value;
    const correctPw = '1070'; // ← 可改成環境變數或更安全機制
    if (pw === correctPw) {
      document.getElementById('teacherLoginScreen').classList.add('hidden');
      document.getElementById('adminPanelScreen').classList.remove('hidden');
      renderAdminMenu();
    } else {
      alert('密碼錯誤！');
    }
  });


      });
      
                 
      // 調整畫布大小
      function resizeCanvas() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          
          // 如果遊戲正在進行，重新定位玩家
          if (player) {
              player.x = Math.min(player.x, canvas.width - player.width);
              player.y = Math.min(player.y, canvas.height - player.height);
          }
          
          // 重新創建星星背景
          createStars();
      }
      
      // 創建星星背景
      function createStars() {
          stars = [];
          const starCount = Math.floor(canvas.width * canvas.height / 2000);
          
          for (let i = 0; i < starCount; i++) {
              stars.push({
                  x: Math.random() * canvas.width,
                  y: Math.random() * canvas.height,
                  size: Math.random() * 2 + 1,
                  speed: Math.random() * 0.5 + 0.1
              });
          }
      }
      
      // 處理登入
      function handleLogin() {
          const studentId = document.getElementById('studentIdInput').value;
          if (studentId.length === 5 && /^\d+$/.test(studentId)) {
              gameState.studentId = studentId;
              document.getElementById('loginScreen').classList.add('hidden');
              document.getElementById('characterScreen').classList.remove('hidden');
          } else {
              alert('請輸入5位數字的班級座號！');
          }
      }
      
      // 計算關卡目標分數
      function calculateLevelGoal(level) {
        return level * level * 100;
      }
      
      // 開始遊戲
      function startGame() {
          if (!gameState.character) {
              alert('請選擇一個角色！');
              return;
          }
          
          document.getElementById('characterScreen').classList.add('hidden');
          document.getElementById('statusBar').classList.remove('hidden');
          document.getElementById('scoreDisplay').classList.remove('hidden');
          document.getElementById('levelGoal').classList.remove('hidden');
          document.getElementById('quizProgress').classList.remove('hidden');
          document.getElementById('specialAttackDisplay').classList.remove('hidden');
          document.getElementById('specialAttackButton').classList.remove('hidden');
          // 顯示暫停與結束按鈕
          document.getElementById('pauseBtn').classList.remove('hidden');
          document.getElementById('quitBtn').classList.remove('hidden');

          // 避免多次綁定暫停/結束事件
          if (!window.pauseBound) {
            const pauseBtn = document.getElementById('pauseBtn');
            const quitBtn = document.getElementById('quitBtn');
            let paused = false;

            pauseBtn.addEventListener('click', () => {
              if (!paused) {
                paused = true;
                gameState.isPlaying = false;
                cancelAnimationFrame(gameAnimationId);
                pauseBtn.textContent = '繼續';
              } else {
                paused = false;
                gameState.isPlaying = true;
                lastTime = performance.now();
                gameAnimationId = requestAnimationFrame(gameLoop);
                // Reset inactivity timer and warning when resuming
                lastMoveTime = Date.now();
                warningIssued = false;
                const warnDiv = document.getElementById('inactivityWarning');
                if (warnDiv) warnDiv.classList.add('hidden');
                pauseBtn.textContent = '暫停';
              }
            });

            quitBtn.addEventListener('click', async () => {
              gameState.isPlaying = false;
              cancelAnimationFrame(gameAnimationId);
              await updateLeaderboard();
              await loadLeaderboardAndHighlight();
            });

            window.pauseBound = true; // 標記已經綁定過，避免重複綁定
          }
          
          // 初始化遊戲狀態
          gameState.level = 1;
          gameState.score = 0;
          gameState.health = 100;
          gameState.maxHealth = 100;
          gameState.attack = 10;
          gameState.isPlaying = true;
          gameState.levelGoal = calculateLevelGoal(1);
          gameState.bossSpawned = false; // ★ 重置
          gameState.correctAnswers = 0;
          gameState.totalQuestions = 0;
          gameState.totalScoreForLevel = 0;
          gameState.specialAttackReady = true;
          gameState.specialAttackCooldown = 0;
          // 撿到「範圍」道具後疊加的半徑；初始 200
          gameState.baseSpecialAttackRadius = 200;
          gameState.specialAttackRadius     = 200;

          // 更新顯示
          updateStatusDisplay(gameState);
          updateSpecialAttackDisplay();
          
          // 創建並儲存玩家物件
          player = createPlayer(canvas, gameState); 
          gameState.specialAttackRadius = gameState.baseSpecialAttackRadius;
          gameState.shield = 0;
          gameState.shieldMax = 0;
          
          // 清空敵人和子彈
          enemies = [];
          bullets = [];
          enemyBullets = [];
          
          // 開始遊戲循環
          lastTime = performance.now();
          gameLoop(lastTime);
      }
      
             
      
      
      // 更新星星
      function updateStars(deltaTime) {
          for (let star of stars) {
              star.y += star.speed * (deltaTime / 16);
              
              // 如果星星超出畫布底部，重置到頂部
              if (star.y > canvas.height) {
                  star.y = 0;
                  star.x = Math.random() * canvas.width;
              }
          }
      }
      
      // 繪製星星
      function drawStars() {
          ctx.fillStyle = 'white';
          for (let star of stars) {
              ctx.beginPath();
              ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
              ctx.fill();
          }
      }
      
          
function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    touchX = touch.clientX;
    touchY = touch.clientY;
    isTouching = true;
    lastMoveTime = Date.now();
    warningIssued = false;
    // 隱藏閒置警告
    const warnDiv = document.getElementById('inactivityWarning');
    if (warnDiv) warnDiv.classList.add('hidden');
}

function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    touchX = touch.clientX;
    touchY = touch.clientY;
    lastMoveTime = Date.now();
    warningIssued = false;
    const warnDiv = document.getElementById('inactivityWarning');
    if (warnDiv) warnDiv.classList.add('hidden');
}

function handleTouchEnd(e) {
    e.preventDefault();
    isTouching = false;
}
    
      
// 處理鍵盤按下
function handleKeyDown(e) {
    switch (e.key) {
        case 'ArrowLeft':
            player.moveLeft = true;
            break;
        case 'ArrowRight':
            player.moveRight = true;
            break;
        case 'ArrowUp':
            player.moveUp = true;
            break;
        case 'ArrowDown':
            player.moveDown = true;
            break;
    }
    lastMoveTime = Date.now();
    warningIssued = false;
    // 隱藏閒置警告
    const warnDiv = document.getElementById('inactivityWarning');
    if (warnDiv) warnDiv.classList.add('hidden');
}
      
      // 處理鍵盤釋放
      function handleKeyUp(e) {
          switch (e.key) {
              case 'ArrowLeft':
                  player.moveLeft = false;
                  break;
              case 'ArrowRight':
                  player.moveRight = false;
                  break;
              case 'ArrowUp':
                  player.moveUp = false;
                  break;
              case 'ArrowDown':
                  player.moveDown = false;
                  break;
          }
      }
    
      function drawShield() {
      if (gameState.shield > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(96,165,250,0.6)';  // 護盾顏色
    ctx.lineWidth = 5;
    ctx.beginPath();
    const cx = player.x + player.width/2;
    const cy = player.y + player.height/2;
    const radius = Math.max(player.width, player.height);
    ctx.arc(cx, cy, radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }
}
      // 繪製玩家
      function drawPlayer() {
          ctx.save();
          
          // 無敵狀態閃爍效果
          if (player.invulnerable && Math.floor(performance.now() / 100) % 2 === 0) {
              ctx.globalAlpha = 0.5;
          }
          
          // 根據角色類型繪製不同的飛船
          if (player.type === 'char1') {
              // 藍鷹號
              ctx.fillStyle = '#5a67d8';
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              
              ctx.beginPath();
              ctx.moveTo(player.x + player.width / 2, player.y);
              ctx.lineTo(player.x, player.y + player.height);
              ctx.lineTo(player.x + player.width / 2, player.y + player.height * 0.7);
              ctx.lineTo(player.x + player.width, player.y + player.height);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              
              // 駕駛艙
              ctx.fillStyle = '#f87171';
              ctx.beginPath();
              ctx.arc(player.x + player.width / 2, player.y + player.height * 0.4, player.width * 0.2, 0, Math.PI * 2);
              ctx.fill();
          } else if (player.type === 'char2') {
              // 綠鯊號
              ctx.fillStyle = '#10b981';
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              
              ctx.beginPath();
              ctx.moveTo(player.x + player.width / 2, player.y);
              ctx.lineTo(player.x, player.y + player.height * 0.6);
              ctx.lineTo(player.x + player.width / 2, player.y + player.height);
              ctx.lineTo(player.x + player.width, player.y + player.height * 0.6);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              
              // 駕駛艙
              ctx.fillStyle = '#fbbf24';
              ctx.beginPath();
              ctx.arc(player.x + player.width / 2, player.y + player.height * 0.35, player.width * 0.24, 0, Math.PI * 2);
              ctx.fill();
          } else if (player.type === 'char3') {
              // 紅龍號
              ctx.fillStyle = '#ef4444';
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              
              ctx.beginPath();
              ctx.moveTo(player.x + player.width / 2, player.y);
              ctx.lineTo(player.x, player.y + player.height * 0.5);
              ctx.lineTo(player.x + player.width * 0.2, player.y + player.height);
              ctx.lineTo(player.x + player.width / 2, player.y + player.height * 0.7);
              ctx.lineTo(player.x + player.width * 0.8, player.y + player.height);
              ctx.lineTo(player.x + player.width, player.y + player.height * 0.5);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              
              // 駕駛艙
              ctx.fillStyle = '#60a5fa';
              ctx.beginPath();
              ctx.arc(player.x + player.width / 2, player.y + player.height * 0.35, player.width * 0.16, 0, Math.PI * 2);
              ctx.fill();
          }
          
          // 引擎火焰
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.moveTo(player.x + player.width * 0.4, player.y + player.height);
          ctx.lineTo(player.x + player.width * 0.5, player.y + player.height + 15);
          ctx.lineTo(player.x + player.width * 0.6, player.y + player.height);
          ctx.closePath();
          ctx.fill();
          
          ctx.restore();
      }
      
          // 更新敵人子彈
      function updateEnemyBullets(deltaTime) {
          for (let i = enemyBullets.length - 1; i >= 0; i--) {
              const bullet = enemyBullets[i];
              bullet.y += bullet.speed * (deltaTime / 16);
              
              // 如果子彈超出畫布底部，移除
              if (bullet.y > canvas.height) {
                  enemyBullets.splice(i, 1);
              }
          }
      }
      
      // 繪製敵人子彈
      function drawEnemyBullets() {
          for (const bullet of enemyBullets) {
              ctx.fillStyle = bullet.color;
              ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
          }
      }
      
      // 繪製敵人
      function drawEnemies() {
        for (const enemy of enemies) {
          ctx.save();

  // —— 修改：頭目（BOSS）改成幽浮圓盤造型 —— 
  if (enemy.type === BOSS_ENEMY_TYPE) {
    // 圓盤底座
    ctx.fillStyle = '#CCCCCC';
    ctx.beginPath();
    ctx.ellipse(
      enemy.x + enemy.width / 2,
      enemy.y + enemy.height * 0.6,
      enemy.width / 2,
      enemy.height / 6,
      0,
      0,
      2 * Math.PI
    );
    ctx.fill();
    // 飛碟圓頂
    ctx.fillStyle = '#66CCFF';
    ctx.beginPath();
    ctx.ellipse(
      enemy.x + enemy.width / 2,
      enemy.y + enemy.height * 0.4,
      enemy.width / 3,
      enemy.height / 4,
      0,
      0,
      2 * Math.PI
    );
    ctx.fill();
    // 畫完直接跳過後面一般繪製
    ctx.restore();  
    continue;  
  }

      // ★ 特殊敵人 (type === 3)：星形
    if (enemy.type === 3) {
      // 星形中心
      const cx = enemy.x + enemy.width/2;
      const cy = enemy.y + enemy.height/2;
      const spikes      = 5;
      const outerRadius = enemy.width  / 2;
      const innerRadius = enemy.width  / 4;
      let rot = Math.PI / 2 * 3;             // 從最上方開始
      const step = Math.PI / spikes;         // 旋轉步長

      ctx.save();                            // 嵌套保存，隔離平移
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.moveTo(0, -outerRadius);           // 先移動到第一個外頂點
      for (let i = 0; i < spikes; i++) {
        // 外頂點
        const xOuter = Math.cos(rot) * outerRadius;
        const yOuter = Math.sin(rot) * outerRadius;
        ctx.lineTo(xOuter, yOuter);
        rot += step;

        // 內頂點
        const xInner = Math.cos(rot) * innerRadius;
        const yInner = Math.sin(rot) * innerRadius;
        ctx.lineTo(xInner, yInner);
        rot += step;
      }
      ctx.closePath();
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.restore();                         // 恢復到最外層座標
    }
              else if (enemy.type === 0) {
                  // 圓形敵人
                  ctx.fillStyle = '#ef4444';
                  ctx.beginPath();
                  ctx.arc(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.width / 2, 0, Math.PI * 2);
                  ctx.fill();
                  
                  // 敵人細節
                  ctx.fillStyle = '#1e293b';
                  ctx.beginPath();
                  ctx.arc(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.width / 4, 0, Math.PI * 2);
                  ctx.fill();
              } else if (enemy.type === 1) {
                  // 三角形敵人
                  ctx.fillStyle = '#f59e0b';
                  ctx.beginPath();
                  ctx.moveTo(enemy.x + enemy.width / 2, enemy.y);
                  ctx.lineTo(enemy.x, enemy.y + enemy.height);
                  ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height);
                  ctx.closePath();
                  ctx.fill();
                  
                  // 敵人細節
                  ctx.fillStyle = '#1e293b';
                  ctx.beginPath();
                  ctx.arc(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.width / 5, 0, Math.PI * 2);
                  ctx.fill();
              } else {
                  // 方形敵人
                  ctx.fillStyle = '#8b5cf6';
                  ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
                  
                  // 敵人細節
                  ctx.fillStyle = '#1e293b';
                  ctx.fillRect(enemy.x + enemy.width / 4, enemy.y + enemy.height / 4, enemy.width / 2, enemy.height / 2);
              }
            // ★ 繪製生命條，一定是在「最外層」座標系下
    const barW = enemy.width, barH = 5;
    const ratio = enemy.health / enemy.maxHealth;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(enemy.x, enemy.y - barH - 2, barW, barH);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(enemy.x, enemy.y - barH - 2, barW * ratio, barH);

    ctx.restore(); // ← 還原最外層
          }
      }
 
      // 繪製子彈
      function drawBullets() {
        for (const bullet of bullets) {
          ctx.fillStyle = bullet.color;
          ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        }
      }
      
      // 使用特殊攻擊
      function useSpecialAttack() {
          if (!gameState.specialAttackReady) return;
          
          // 創建特殊攻擊效果
          const specialAttack = document.createElement('div');
          specialAttack.className = 'special-attack';
          specialAttack.style.left = `${player.x + player.width / 2}px`;
          specialAttack.style.top = `${player.y + player.height / 2}px`;
          document.getElementById('gameContainer').appendChild(specialAttack);
          
          // 對範圍內的敵人造成傷害
          const attackRadius = gameState.specialAttackRadius;
          const attackDamage = gameState.attack * 3; // 特殊攻擊傷害
          
          const playerCenterX = player.x + player.width / 2;
          const playerCenterY = player.y + player.height / 2;
          
          // 檢查每個敵人是否在攻擊範圍內
          for (let i = enemies.length - 1; i >= 0; i--) {
              const enemy = enemies[i];
              const enemyCenterX = enemy.x + enemy.width / 2;
              const enemyCenterY = enemy.y + enemy.height / 2;
              
              // 計算敵人與玩家的距離
              const distance = Math.sqrt(
                  Math.pow(enemyCenterX - playerCenterX, 2) + 
                  Math.pow(enemyCenterY - playerCenterY, 2)
              );
              
              // 如果敵人在攻擊範圍內，造成傷害
              if (distance <= attackRadius) {
                  enemy.health -= attackDamage;
                  
                  // 如果敵人死亡，移除敵人並增加分數
                  if (enemy.health <= 0) {
                      gameState.score += enemy.points;
                      gameState.totalScoreForLevel += enemy.points;
                      enemies.splice(i, 1);
                  }
              }
          }
          
          // 清除範圍內的敵人子彈
          for (let i = enemyBullets.length - 1; i >= 0; i--) {
              const bullet = enemyBullets[i];
              const bulletCenterX = bullet.x + bullet.width / 2;
              const bulletCenterY = bullet.y + bullet.height / 2;
              
              // 計算子彈與玩家的距離
              const distance = Math.sqrt(
                  Math.pow(bulletCenterX - playerCenterX, 2) + 
                  Math.pow(bulletCenterY - playerCenterY, 2)
              );
              
              // 如果子彈在攻擊範圍內，移除子彈
              if (distance <= attackRadius) {
                  enemyBullets.splice(i, 1);
              }
          }
          
          // 更新分數顯示
          updateStatusDisplay(gameState);
          
          // 設置特殊攻擊冷卻
          gameState.specialAttackReady = false;
          gameState.specialAttackCooldown = gameState.specialAttackMaxCooldown;
          updateSpecialAttackDisplay();
          
          // 移除特殊攻擊效果
          setTimeout(() => {
              specialAttack.remove();
          }, 1000);
      }
      
      // 更新特殊攻擊冷卻
      function updateSpecialAttack(deltaTime) {
          if (!gameState.specialAttackReady) {
              gameState.specialAttackCooldown -= deltaTime;
              
              if (gameState.specialAttackCooldown <= 0) {
                  gameState.specialAttackReady = true;
                  gameState.specialAttackCooldown = 0;
              }
              
              updateSpecialAttackDisplay();
          }
      }
      
      // 更新特殊攻擊顯示
      function updateSpecialAttackDisplay() {
          const cooldownPercentage = gameState.specialAttackReady ? 100 : 
              (1 - gameState.specialAttackCooldown / gameState.specialAttackMaxCooldown) * 100;
          
          document.getElementById('specialAttackBar').style.width = `${cooldownPercentage}%`;
          
          // 更新按鈕冷卻顯示
          const cooldownRotation = gameState.specialAttackReady ? 0 : 
              360 * (gameState.specialAttackCooldown / gameState.specialAttackMaxCooldown);
          
          document.getElementById('specialAttackButtonCooldown').style.transform = `rotate(${cooldownRotation}deg)`;
      }
      
      // 檢查碰撞
      function checkCollisions() {
        // ----------------------------------------
        // 1) 玩家子彈 vs. 敵人
        // ----------------------------------------
        for (let i = bullets.length - 1; i >= 0; i--) {
          const b = bullets[i];
          for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (
              b.x <  e.x + e.width &&
              b.x + b.width > e.x &&
              b.y <  e.y + e.height &&
              b.y + b.height > e.y
            ) {
              e.health -= b.damage;
              bullets.splice(i, 1);
              if (e.health <= 0) {
                if (e.dropPowerup) dropPowerup(e.x, e.y, powerups);
                gameState.score             += e.points;
                gameState.totalScoreForLevel += e.points;
                enemies.splice(j, 1);
                updateStatusDisplay(gameState);
              }
              break;
            }
          }
        }
      
        // ----------------------------------------
        // 2) 敵人子彈 vs. 玩家
        // ----------------------------------------
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
          const b = enemyBullets[i];
          if (
            b.x <  player.x + player.width  &&
            b.x + b.width > player.x        &&
            b.y <  player.y + player.height &&
            b.y + b.height > player.y
          ) {
            // 如果有護盾，先扣護盾
            if (gameState.shield > 0) {
              const dmg = b.damage;
              gameState.shield -= dmg;
              // 護盾扣到負值時，把剩下的傷害算回生命
              if (gameState.shield < 0) {
                gameState.health += gameState.shield; 
                gameState.shield = 0;
              }
              enemyBullets.splice(i, 1);
              updateStatusDisplay(gameState);
            }
            // 沒護盾才走常規受傷 + 無敵邏輯
            else if (!player.invulnerable) {
              gameState.health -= b.damage;
              enemyBullets.splice(i, 1);
              player.invulnerable    = true;
              player.invulnerableTime = 1000;
              // 閃爍特效
              document.getElementById('gameContainer').classList.add('damage-flash');
              setTimeout(() => {
                document.getElementById('gameContainer').classList.remove('damage-flash');
              }, 300);
              updateStatusDisplay(gameState);
            }
          }
        }
      
        // ----------------------------------------
        // 3) 敵人 vs. 玩家（貼身撞）
        // ----------------------------------------
        for (let i = enemies.length - 1; i >= 0; i--) {
          const e = enemies[i];
          if (
            player.x <  e.x + e.width &&
            player.x + player.width > e.x &&
            player.y <  e.y + e.height &&
            player.y + player.height > e.y
          ) {
            // 碰撞傷害固定 20
            const COLLIDE_DMG = 20;
            if (gameState.shield > 0) {
              gameState.shield -= COLLIDE_DMG;
              if (gameState.shield < 0) {
                gameState.health += gameState.shield;
                gameState.shield = 0;
              }
              // 直接移除這隻敵人
              enemies.splice(i, 1);
              updateStatusDisplay(gameState);
            }
            else if (!player.invulnerable) {
              gameState.health -= COLLIDE_DMG;
              enemies.splice(i, 1);
              player.invulnerable    = true;
              player.invulnerableTime = 1000;
              document.getElementById('gameContainer').classList.add('damage-flash');
              setTimeout(() => {
                document.getElementById('gameContainer').classList.remove('damage-flash');
              }, 300);
              updateStatusDisplay(gameState);
            }
          }
        }
      }
      

      // 關卡完成
      function levelComplete() {
          gameState.isPlaying = false;
          cancelAnimationFrame(gameAnimationId);
          
          document.getElementById('currentScore').textContent = gameState.score;
          document.getElementById('levelCompleteScreen').classList.remove('hidden');
      }
      
      // 顯示問題畫面
      function showQuestionScreen() {
                     
        // 1. 切換畫面
        document.getElementById('levelCompleteScreen').classList.add('hidden');
        document.getElementById('questionScreen').classList.remove('hidden');
        gameState.hasAnswered = false;

        // 2. 從 unusedQuestions 中隨機抽題，不重複
        if (unusedQuestions.length === 0) {
          unusedQuestions = [...mathQuestions];
        }
        const idx = Math.floor(Math.random() * unusedQuestions.length);
        currentQuestion = unusedQuestions.splice(idx, 1)[0];

        // 3. 顯示題目
        document.getElementById('questionText').textContent = currentQuestion.question;

        // 4. 清空舊選項並加入新選項按鈕
        const optContainer = document.getElementById('options');
        optContainer.innerHTML = '';
        currentQuestion.options.forEach((opt, i) => {
          const btn = document.createElement('button');
          btn.textContent = opt;
          btn.className = 'option-btn';
          btn.addEventListener('click', () => checkAnswer(i));
          optContainer.appendChild(btn);
        });

        // 5. 啟動倒數計時器（例如 20 秒）
        startTimer();
      }
           
      // 啟動計時器
      function startTimer() {
        clearInterval(timerInterval);      // 先清掉舊的
        let timeLeft = 20;
        const timerTextEl = document.getElementById('timerText');
        const timerBarEl  = document.getElementById('timerBar');
      
        timerTextEl.textContent = `剩餘時間：${timeLeft} 秒`;
        timerBarEl.style.width = '100%';
      
        timerInterval = setInterval(() => {
          timeLeft--;
          timerTextEl.textContent = `剩餘時間：${timeLeft} 秒`;
          timerBarEl.style.width = `${(timeLeft / 20) * 100}%`;
      
          if (timeLeft <= 0) {
            clearInterval(timerInterval);
            checkAnswer(-1);
          }
        }, 1000);
      }
      
      
    
      // 顯示反饋
      function showFeedback(isCorrect) {
          const feedback = document.createElement('div');
          feedback.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
          feedback.textContent = isCorrect ? '正確！' : '錯誤！';
          document.getElementById('gameContainer').appendChild(feedback);
          
          // 2秒後移除反饋
          setTimeout(() => {
              feedback.remove();
          }, 1500);
      }
      
      // 顯示升級畫面
      function showUpgradeScreen() {
          document.getElementById('upgradeScreen').classList.remove('hidden');
          
          // 顯示升級信息
          const upgradeText = document.getElementById('upgradeText');
          upgradeText.textContent = `戰機已升級！等級: ${gameState.level}, 攻擊力: ${gameState.attack}, 生命值: ${gameState.maxHealth}`;
          
          // 顯示升級後的飛船
          const upgradeShip = document.getElementById('upgradeShip');
          
          // 根據角色類型繪製不同的飛船
          let shipSvg = '';
          if (gameState.character === 'char1') {
              // 藍鷹號
              shipSvg = `
                  <polygon points="50,10 20,90 50,70 80,90" fill="#5a67d8" stroke="#fff" stroke-width="2"/>
                  <circle cx="50" cy="45" r="10" fill="#f87171"/>
              `;
          } else if (gameState.character === 'char2') {
              // 綠鯊號
              shipSvg = `
                  <polygon points="50,10 10,60 50,80 90,60" fill="#10b981" stroke="#fff" stroke-width="2"/>
                  <circle cx="50" cy="40" r="12" fill="#fbbf24"/>
              `;
          } else {
              // 紅龍號
              shipSvg = `
                  <polygon points="50,10 20,50 10,80 50,60 90,80 80,50" fill="#ef4444" stroke="#fff" stroke-width="2"/>
                  <circle cx="50" cy="40" r="8" fill="#60a5fa"/>
              `;
          }
          
          upgradeShip.innerHTML = shipSvg;
      }
      
      // 開始下一關
      function startNextLevel() {
          document.getElementById('upgradeScreen').classList.add('hidden');
          
          // 更新關卡目標
          gameState.levelGoal = calculateLevelGoal(gameState.level);
          
          gameState.bossSpawned = false;    // ★ 重置，下一關可以再出頭目
          // 更新顯示
          updateStatusDisplay(gameState);
          
          // 清空敵人和子彈
          enemies = [];
          bullets = [];
          enemyBullets = [];
          
          // 重新開始遊戲循環
          gameState.isPlaying = true;
          lastTime = performance.now();
          gameLoop(lastTime);
      }
      
 /**
 * 開始三題數學挑戰
 */
function startMathChallenge() {
  // 隱藏「關卡完成」畫面，顯示題目畫面
  document.getElementById('levelCompleteScreen').classList.add('hidden');
  document.getElementById('questionScreen').classList.remove('hidden');

  // 重置計數
  gameState.challengeCorrectCount = 0;
  gameState.challengeCurrentCount = 0;

  // 問第一題
  askMathQuestion();
}

/**
 * 顯示下一題（最多 3 題）
 */
function askMathQuestion() {
  // 全部做完，進入結算
  if (gameState.challengeCurrentCount >= 3) {
    finishMathChallenge();
    return;
  }

  gameState.challengeCurrentCount++;

  // 從 unusedQuestions 隨機抽一題，不重複
  if (unusedQuestions.length === 0) {
    unusedQuestions = [...mathQuestions];
  }
  const idx = Math.floor(Math.random() * unusedQuestions.length);
  currentQuestion = unusedQuestions.splice(idx, 1)[0];

  // 顯示題目與選項
  document.getElementById('questionText').textContent = currentQuestion.question;
  const optContainer = document.getElementById('options');
  optContainer.innerHTML = '';
  currentQuestion.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.textContent = opt;
    btn.className = 'option-btn';
    btn.addEventListener('click', () => handleChallengeAnswer(i));
    optContainer.appendChild(btn);
  });

  // 啟動 20 秒倒數
  startTimer();
}

/**
 * 處理挑戰階段答案
 * @param {number} selectedIndex 選項索引 (-1 為超時)
 */
function handleChallengeAnswer(selectedIndex) {
  clearInterval(timerInterval);
  const isCorrect = selectedIndex === currentQuestion.answer;
  if (isCorrect) {
    gameState.challengeCorrectCount++;
  }
  showFeedback(isCorrect);

  // 延遲 1.5 秒後問下一題
  setTimeout(() => {
    askMathQuestion();
  }, 1500);
}

/**
 * 三題結束後，依答對題數恢復血量，並保留升級畫面、強化攻擊力
 */
function finishMathChallenge() {
  // 0. 隱藏題目畫面
  document.getElementById('questionScreen').classList.add('hidden');

  // 1. 每過一關，增加生命上限 10 點
  const healthBoost = 10;
  gameState.maxHealth += healthBoost;
  // （若想直接補滿新的上限，可加：gameState.health = gameState.maxHealth;）

  // 2. 計算本次答對題數的回血比例
  const c = gameState.challengeCorrectCount;
  let restorePercent = 0;
  if (c === 1)      restorePercent = 0.3;
  else if (c === 2) restorePercent = 0.6;
  else if (c === 3) restorePercent = 1;

  // 3. 按照新上限依比例回血
  if (restorePercent > 0) {
    const gain = Math.floor(gameState.maxHealth * restorePercent);
    gameState.health = Math.min(gameState.maxHealth, gameState.health + gain);
  }

  // 4. 強化戰機攻擊力（每次升級 +5）
  const attackBoost = 5;
  gameState.attack += attackBoost;

  // 5. 等級＋1，並更新下一關的過關目標分數
  gameState.level += 1;
  gameState.levelGoal = calculateLevelGoal(gameState.level);

  // 6. 更新狀態列（血量／上限／攻擊／等級／分數等）
  updateStatusDisplay(gameState);

  // 7. 顯示升級畫面（裡面會呈現新的 maxHealth、attack、level）
  showUpgradeScreen();
}
      
      // 遊戲結束
      function gameOver() {
          gameState.isPlaying = false;
          // 隱藏暫停與結束按鈕
          document.getElementById('pauseBtn').classList.add('hidden');
          document.getElementById('quitBtn').classList.add('hidden');
          cancelAnimationFrame(gameAnimationId);

          // 不要單純只顯示 gameOver 畫面，改成：
          updateLeaderboard().then(() => {
            loadLeaderboardAndHighlight();
          }).catch(err => {
            console.error('送分或載入排行榜失敗', err);
            // 如果失敗，至少顯示遊戲結束畫面
            document.getElementById('finalScore').textContent = gameState.score;
            document.getElementById('finalLevel').textContent = gameState.level;
            document.getElementById('gameOverScreen').classList.remove('hidden');
          });
      }
     
/**
 * 檢查玩家是否撿取到道具
 */
function checkPowerupPickup() {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    // 矩形碰撞：道具 (p.x,p.y,p.width,p.height) 和 玩家 (player.x,player.y,player.width,player.height)
    if (
      p.x < player.x + player.width &&
      p.x + p.width  > player.x &&
      p.y < player.y + player.height &&
      p.y + p.height > player.y
    ) {
      // 撿到道具，套用效果
      applyPowerupEffect(p.type);
      // 移除道具
      powerups.splice(i, 1);
      // 更新狀態列顯示（如攻擊、生命等）
      updateStatusDisplay(gameState);
    }
  }
}

      // 重新開始遊戲
      function restartGame() {
          document.getElementById('gameOverScreen').classList.add('hidden');
          document.getElementById('characterScreen').classList.remove('hidden');
      }
      // 再試一次：切回選機畫面
        document.getElementById('restartBtn').addEventListener('click', () => {
      // 隱藏遊戲結束畫面
        document.getElementById('gameOverScreen').classList.add('hidden');
      // 顯示角色選擇畫面（或你想要重來的畫面）
        document.getElementById('characterScreen').classList.remove('hidden');
      // （可選）重置 localStorage 排行榜或其他狀態
      // leaderboard = [];
  });

// 1. 取得排行榜並顯示
async function loadLeaderboard() {
    try {
      // 向後端 GET 排行榜
      const res = await fetch(`${API_BASE}/api/leaderboard?limit=500`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();

      // 清空舊資料
      const tbody = document.getElementById('leaderboardBody');
      tbody.innerHTML = '';

      // 依序渲染每一筆
      list.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${entry.studentId}</td>
          <td>${entry.score}</td>
          <td>${entry.level}</td>
        `;
        tbody.appendChild(tr);
      });

      // 切換畫面：隱藏遊戲結束頁、顯示排行榜頁
      document.getElementById('gameOverScreen').classList.add('hidden');
      document.getElementById('leaderboardScreen').classList.remove('hidden');
    } catch (err) {
      console.error('載入排行榜失敗', err);
      alert('載入排行榜失敗：' + err.message);
    }
}

// 進階排行榜載入並高亮自己，彈出班級/總排名
async function loadLeaderboardAndHighlight() {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=500`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';

    // 當前玩家的 studentId
    const myId = gameState.studentId;
    const myClassPrefix = myId.slice(0, 3);

    // 先初始化 classList 並排序
    const classList = list.filter(e => e.studentId.startsWith(myClassPrefix));
    classList.sort((a, b) => b.score - a.score || b.level - a.level);

    let classRank = 0;
    let overallRank = 0;
    let myRow = null;

    list.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      const isMe = entry.studentId === myId;

      // 班級名次 (在 classList 裡找)
      let classMedal = '';
      const classRankIdx = classList.findIndex(c => c.studentId === entry.studentId);
      if (classRankIdx === 0) classMedal = ' 🥇';
      else if (classRankIdx === 1) classMedal = ' 🥈';
      else if (classRankIdx === 2) classMedal = ' 🥉';

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${entry.studentId}${isMe ? ' 🏆' : ''}${classMedal}</td>
        <td>${entry.score}</td>
        <td>${entry.level}</td>
      `;
      if (isMe) {
        tr.style.backgroundColor = 'rgba(255,255,0,0.5)'; // 黃色高亮
        overallRank = idx + 1;
        myRow = tr; // 記錄自己的那一列
      }
      tbody.appendChild(tr);
    });

    // 額外計算班級內排名
    classList.forEach((entry, idx) => {
      if (entry.studentId === myId) {
        classRank = idx + 1;
      }
    });

    // 先切換畫面：隱藏遊戲結束頁、顯示排行榜頁
    document.getElementById('gameOverScreen').classList.add('hidden');
    document.getElementById('leaderboardScreen').classList.remove('hidden');
    // 允許排行榜可滾動並顯示返回主畫面按鈕
    document.getElementById('leaderboardScreen').style.overflow = 'auto';
    document.getElementById('backToMenuBtn').classList.remove('hidden');

    // 顯示提示訊息，並儲存 setTimeout ID 方便後續清除
    leaderboardTimeoutId = setTimeout(() => {
      if (confirm(`你的班級排名：第 ${classRank} 名\n你的總排名：第 ${overallRank} 名\n\n按「好」回到主畫面，按「取消」留在排行榜`)) {
        clearTimeout(leaderboardTimeoutId);
        leaderboardTimeoutId = null;
        // 重置主要遊戲狀態
        gameState.level = 1;
        gameState.score = 0;
        gameState.health = 100;
        gameState.maxHealth = 100;
        gameState.attack = 10;
        gameState.correctAnswers = 0;
        gameState.totalQuestions = 0;
        gameState.totalScoreForLevel = 0;
        gameState.isPlaying = false;
        gameState.specialAttackReady = true;
        gameState.specialAttackCooldown = 0;
        gameState.specialAttackRadius = 200;
        gameState.shield = 0;
        gameState.shieldMax = 0;
        // 清空敵人、子彈、道具
        enemies = [];
        bullets = [];
        enemyBullets = [];
        powerups = [];
        // 重置閒置計時器狀態
        lastMoveTime = Date.now();
        warningIssued = false;
        document.getElementById('leaderboardScreen').classList.add('hidden');
        document.getElementById('characterScreen').classList.remove('hidden');
      } else {
        // 留在排行榜：若找到自己的列則滾動到該列
        if (myRow) {
          document.getElementById('leaderboardScreen').style.overflow = 'auto';
          myRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 200);
  } catch (err) {
    console.error('載入排行榜失敗', err);
    alert('載入排行榜失敗：' + err.message);
  }
}
  // 綁定『繼續任務』按鈕
document.getElementById('continueBtn').addEventListener('click', startNextLevel);

  // 2. 綁定「查看排行榜」按鈕
  document.getElementById('leaderboardBtn')
    .addEventListener('click', loadLeaderboard);
  
  // 3. 綁定「返回主選單」按鈕
  document.getElementById('backToMenuBtn')
    .addEventListener('click', () => {
      document.getElementById('leaderboardScreen').classList.add('hidden');
      // 依你的需求，這裡可以返回到 characterScreen 或 loginScreen
      document.getElementById('characterScreen').classList.remove('hidden');
    });
  
async function renderAdminMenu() {
  const adminContent = document.getElementById('adminContent');
  adminContent.innerHTML = `<h2 class="text-2xl font-bold mb-4">題庫管理</h2>
    <button id="addQuestionBtn" class="btn mb-4">新增題目</button>
    <table class="leaderboard-table">
      <thead>
        <tr><th>#</th><th>題目</th><th>選項</th><th>答案</th><th>操作</th></tr>
      </thead>
      <tbody id="questionsTbody"></tbody>
    </table>`;

  // 綁定「新增題目」
  document.getElementById('addQuestionBtn').onclick = () => {
    // TODO: 彈出表單，或跳到新增頁面
    alert('請實作「新增題目」表單');
  };

  try {
    // 從後端拿題庫列表
    const res = await fetch(`${API_BASE}/api/questions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const questions = await res.json();

    const tbody = document.getElementById('questionsTbody');
    questions.forEach((q, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${q.question}</td>
        <td>${q.options.map((o, i) => `${i+1}. ${o}`).join('<br>')}</td>
        <td>${q.options[q.answer]}</td>
        <td>
          <button class="btn btn-sm mr-2 edit-btn">編輯</button>
          <button class="btn btn-sm delete-btn">刪除</button>
        </td>`;
      // 編輯
      tr.querySelector('.edit-btn').onclick = () => {
        // TODO: 彈出表單並填入 q，送 PUT /api/questions/:id
        alert(`請實作編輯題目 ID=${q._id}`);
      };
      // 刪除
      tr.querySelector('.delete-btn').onclick = async () => {
        if (!confirm('確定要刪除這題嗎？')) return;
        await fetch(`${API_BASE}/api/questions/${q._id}`, { method: 'DELETE' });
        renderAdminMenu(); // 刪除後重新載入
      };
      tbody.appendChild(tr);
    });
  } catch (err) {
    adminContent.innerHTML += `<p class="text-red-400">載入題庫失敗：${err.message}</p>`;
  }
}

async function renderEditQuestions() {
      const container = document.getElementById('adminContent');
      // 1. 從後端讀題庫
      const res = await fetch('/api/questions');
      const qs  = await res.json();
    
      // 2. 產生表格
      let html = `<h2 class="text-2xl mb-4">題庫管理</h2>
        <button id="addQuestionBtn" class="btn mb-4">新增題目</button>
        <table class="leaderboard-table text-white">
          <thead><tr>
            <th>#</th><th>題目</th><th>答案</th><th>操作</th>
          </tr></thead><tbody>`;
      qs.forEach((q, i) => {
        html += `<tr>
          <td>${i+1}</td>
          <td>${q.question}</td>
          <td>${q.options[q.answer]}</td>
          <td>
            <button data-id="${q._id}" class="editQ btn text-sm mr-2">編輯</button>
            <button data-id="${q._id}" class="delQ btn text-sm">刪除</button>
          </td>
        </tr>`;
      });
      html += `</tbody></table>`;
      container.innerHTML = html;
    
      // 3. 綁定「編輯」按鈕
      container.querySelectorAll('.editQ').forEach(btn =>
        btn.addEventListener('click', async e => {
          const id = e.target.dataset.id;
          const old = qs.find(x => x._id === id);
          const newQ  = prompt('修改題目：', old.question);
          const opts  = [
            prompt('選項1：', old.options[0]),
            prompt('選項2：', old.options[1]),
            prompt('選項3：', old.options[2]),
            prompt('選項4：', old.options[3]),
          ];
          const ans   = Number(prompt('正確答案編號 (1-4)：', old.answer+1)) - 1;
          await fetch(`/api/questions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: newQ, options: opts, answer: ans })
          });
          renderEditQuestions();
        })
      );
    
      // 4. 綁定「刪除」按鈕
      container.querySelectorAll('.delQ').forEach(btn =>
        btn.addEventListener('click', async e => {
          if (!confirm('確定要刪除？')) return;
          const id = e.target.dataset.id;
          await fetch(`/api/questions/${id}`, { method: 'DELETE' });
          renderEditQuestions();
        })
      );
    
      // 5. 綁定「新增題目」
      document.getElementById('addQuestionBtn')
        .addEventListener('click', async () => {
          const question = prompt('新題目：');
          const options  = [
            prompt('選項1：',''),
            prompt('選項2：',''),
            prompt('選項3：',''),
            prompt('選項4：','')
          ];
          const answer   = Number(prompt('正確答案編號 (1-4)：')) - 1;
          await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, options, answer })
          });
          renderEditQuestions();
        });
    }
    
  async function renderAdminLeaderboard() {
      const container = document.getElementById('adminContent');
      // 1. 渲染標題、篩選器與表格
      container.innerHTML = `
        <h2 class="text-2xl mb-4">排行榜</h2>
        <div class="mb-4">
          <label for="classFilter" class="text-white mr-2">班級篩選：</label>
          <select id="classFilter" class="bg-gray-800 text-white border-2 border-blue-500 rounded p-2">
            <option value="">全部</option>
            ${Array.from({length:17},(_,i)=>301+i)
              .map(c=>`<option value="${c}">${c}班</option>`)
              .join('')}
            <option value="other">其他</option>
          </select>
        </div>
        <table class="leaderboard-table text-white">
          <thead><tr><th>排名</th><th>座號</th><th>分數</th><th>等級</th><th>操作</th></tr></thead>
          <tbody id="adminLbBody"></tbody>
        </table>
      `;
    
      const classFilter = document.getElementById('classFilter');
      classFilter.addEventListener('change', fetchAndRender);
    
      // 2. 建立取得並渲染函式
      async function fetchAndRender() {
        try {
          const res = await fetch(`${API_BASE}/api/leaderboard?limit=500`);
          const list = await res.json();
          const prefix = classFilter.value;
          let filtered;
          if (!prefix) {
            filtered = list;
          } else if (prefix === 'other') {
            filtered = list.filter(e => !e.studentId.startsWith('3'));
          } else {
            filtered = list.filter(e => e.studentId.startsWith(prefix));
          }
          // 4. 渲染表格，前10名加 .top10
          const tbody = document.getElementById('adminLbBody');
          tbody.innerHTML = '';
          filtered.forEach((e, i) => {
            const tr = document.createElement('tr');
            tr.style.height = '16px';
            if (i < 10) tr.classList.add('top10');
            tr.innerHTML = `
              <td>${i+1}</td>
              <td>${e.studentId}</td>
              <td>${e.score}</td>
              <td>${e.level}</td>
              <td>
                <button class="btn btn-sm delete-entry-btn" data-id="${e._id}" style="padding:4px 12px; font-size:14px;">刪除</button>
              </td>
            `;
            tbody.appendChild(tr);
          });
        } catch (err) {
          alert('讀取排行榜失敗：' + err.message);
        }
      }
    
      // 初次載入
      fetchAndRender();
    }

    document.addEventListener('DOMContentLoaded', () => {
  // 綁定編輯題庫
  document.getElementById('editQuestionsBtn')
    .addEventListener('click', renderEditQuestions);

  // 綁定清除排行榜
  document.getElementById('clearLeaderboardBtn')
    .addEventListener('click', async () => {
      if (!confirm('確定要清除所有排行榜資料？')) return;
      try {
        const res = await fetch(`${API_BASE}/api/leaderboard`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message);
        renderAdminLeaderboard();
      } catch (err) {
        alert('清除失敗：' + err.message);
      }
    });

  // 綁定返回主畫面
  document.getElementById('adminPanelBackBtn')
    .addEventListener('click', () => {
      document.getElementById('adminPanelScreen').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
    });

  // **這裡新增**：綁定「觀看排行榜」
  document.getElementById('viewLeaderboardBtn')
    .addEventListener('click', renderAdminLeaderboard);

  // 刪除排行榜條目
  document.getElementById('adminContent').addEventListener('click', async (evt) => {
    if (evt.target.matches('.delete-entry-btn')) {
      const entryId = evt.target.dataset.id;
      console.log('刪除請求 entryId:', entryId);
      if (!entryId) {
        alert('找不到有效的刪除 ID');
        return;
      }
      if (confirm('確定要刪除此名次條目嗎？')) {
        try {
          const res = await fetch(`${API_BASE}/api/leaderboard/${entryId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          renderAdminLeaderboard();
        } catch (err) {
          alert('刪除失敗：' + err.message);
        }
      }
    }
  });
});
