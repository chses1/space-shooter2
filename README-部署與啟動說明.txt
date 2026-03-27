【專案結構】
space-math-shooter/
├─ server.js
├─ package.json
├─ public/
│  ├─ index.html
│  ├─ main.js
│  ├─ questions.js
│  ├─ ui.js
│  ├─ player.js
│  ├─ enemy.js
│  ├─ bullet.js
│  ├─ boss.png
│  └─ indexbc.jpeg
├─ data/
│  └─ defaultQuestions.js
├─ models/
│  ├─ Question.js
│  └─ LeaderboardEntry.js
└─ uploads/   （啟動後自動建立）

【本機啟動】
1. 打開終端機到專案根目錄
2. 執行 npm install
3. 執行 npm start
4. 開啟 http://localhost:3000

【重要】
- 不要只雙擊 index.html 測試，題庫匯入/排行榜需要後端。
- 若你用 Live Server 開 public/index.html，前端也會自動改去連本機 3000。
- 若部署到 Render，請把整個專案根目錄上傳，不要只上傳 public。
- Render 的 Start Command 用：npm start
- 若沒設定 MONGO_URI，也能先用記憶體模式正常測試。
