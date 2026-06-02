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

【Google 登入 / Firebase 設定】
1. 到 Firebase 建立專案，啟用 Authentication 的 Google 登入。
2. 目前程式已內建這個 Firebase Web App 設定：
   - FIREBASE_API_KEY=AIzaSyBSisOANfkKW9AyCNGXX7zgzOKc1YjjziI
   - FIREBASE_AUTH_DOMAIN=space-shooter-eb3f8.firebaseapp.com
   - FIREBASE_PROJECT_ID=space-shooter-eb3f8
   - FIREBASE_APP_ID=1:657602014258:web:6a6c55bedcfd5b74d1602b
   若未來更換 Firebase 專案，再到 Render 覆蓋以上環境變數即可。
3. 後端驗證 Google 登入需要 Firebase Admin，這是正式登入必填：
   - 建議在 Firebase「服務帳戶」產生私密金鑰 JSON。
   - 將整份 JSON 壓成單行後填入 Render 環境變數 FIREBASE_SERVICE_ACCOUNT。
4. 教師後台白名單：
   - 預設已允許 cairo1680@apps.chses.tyc.edu.tw。
   - 若要增加老師，設定 TEACHER_EMAILS，例如：
     cairo1680@apps.chses.tyc.edu.tw,teacher2@example.com
5. 正式記錄學生 Google 帳號、座號與排行榜時，請務必設定 MONGO_URI。
