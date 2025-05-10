// server.js
require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const upload = multer({ dest: 'uploads/' });
const { Parser } = require('json2csv');

// 1. 建立 app 實例，並先掛中間件
const app = express();
app.use(cors());
app.use(express.json());

// 2. 載入 Mongoose model
const defaultQuestions = require('./data/defaultQuestions');
const Question       = require('./models/Question');
const LeaderboardEntry = require('./models/LeaderboardEntry');

// 3. 題庫管理 API
app.get('/api/questions', async (req, res) => {
  try {
    const qs = await Question.find().select('-__v');
    return res.json(qs);
  } catch (err) {
    console.error('■■■ GET /api/questions 發生錯誤 ■■■', err);
    return res.status(500).json({ message: '伺服器錯誤', detail: err.message });
  }
});

app.post('/api/questions', async (req, res) => {
  try {
    const { question, options, answer } = req.body;
    const q = await Question.create({ question, options, answer });
    res.status(201).json(q);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
app.put('/api/questions/:id', async (req, res) => {
  try {
    const updated = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: '找不到該題目' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
app.delete('/api/questions/:id', async (req, res) => {
  try {
    const deleted = await Question.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: '找不到該題目' });
    res.json({ message: '已刪除題目' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});

/**
 * CSV 批次匯入或更新題目
 * 前端上傳檔案欄位名稱：file
 * CSV 欄位：_id,question,options,answer
 */
app.post('/api/questions/import', upload.single('file'), async (req, res) => {
  const rows = [];
  fs.createReadStream(req.file.path)
    .pipe(csv({ skipLines: 0, strict: true }))
    .on('data', data => rows.push(data))
    .on('end', async () => {
      fs.unlinkSync(req.file.path);
      try {
        for (const row of rows) {
          const opts = row.options.split(';').map(s => s.trim());
          const ans  = parseInt(row.answer, 10);
          if (row._id) {
            await Question.findByIdAndUpdate(row._id, {
              question: row.question,
              options: opts,
              answer: ans
            });
          } else {
            await Question.create({
              question: row.question,
              options: opts,
              answer: ans
            });
          }
        }
        res.json({ message: 'CSV 匯入完成', count: rows.length });
      } catch (err) {
        console.error('CSV 匯入失敗：', err);
        res.status(500).json({ message: 'CSV 匯入失敗', detail: err.message });
      }
    })
    .on('error', err => {
      console.error('CSV 解析錯誤：', err);
      res.status(400).json({ message: 'CSV 解析失敗', detail: err.message });
    });
});

/**
 * 匯出所有題庫為 CSV
 */
app.get('/api/questions/export', async (req, res) => {
  try {
    const questions = await Question.find().lean();
    // 將選項拆成四個獨立欄位，方便編輯
    const data = questions.map(q => {
      const opts = q.options || [];
      return {
        _id:      q._id.toString(),
        question: q.question,
        option1:  opts[0] || '',
        option2:  opts[1] || '',
        option3:  opts[2] || '',
        option4:  opts[3] || '',
        answer:   q.answer
      };
    });
    // 欄位順序：_id、題目、四個選項、答案
    const fields = ['_id','question','option1','option2','option3','option4','answer'];
    const parser = new Parser({ fields });
    const csv    = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment('questions.csv');
    res.send(csv);
  } catch (err) {
    console.error('匯出 CSV 失敗：', err);
    res.status(500).json({ message: '匯出失敗', detail: err.message });
  }
});

// 4. 排行榜 API
app.post('/api/leaderboard', async (req, res) => {
  try {
    const { studentId, score, level } = req.body;
    if (!studentId || score==null || level==null)
      return res.status(400).json({ message: '缺少 studentId、score 或 level' });

    const exist = await LeaderboardEntry.findOne({ studentId });
    if (exist) {
      if (score > exist.score) {
        exist.score = score; exist.level = level;
        await exist.save();
      }
      return res.json({ entry: exist });
    }
    const entry = await LeaderboardEntry.create({ studentId, score, level });
    res.status(201).json({ entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const list = await LeaderboardEntry.find()
      .sort({ score: -1, updatedAt: 1 })
      .limit(limit)
      .select('-__v');
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});
app.delete('/api/leaderboard', async (req, res) => {
  try {
    await LeaderboardEntry.deleteMany({});
    res.json({ message: '✅ 已清除所有排行榜資料' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '伺服器錯誤' });
  }
});

// 刪除單筆排行榜資料
app.delete('/api/leaderboard/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await LeaderboardEntry.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: '找不到該筆排行榜資料' });
    }
    return res.sendStatus(204);
  } catch (err) {
    console.error('刪除單筆排行榜失敗：', err);
    return res.status(500).json({ message: '伺服器錯誤', detail: err.message });
  }
});

// 5. 靜態檔與前端 routing（放在最下面）
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6. 連上 MongoDB 並啟動
const PORT      = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/spaceShooter';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB 已連線');

    // 如果題庫 collection 是空的，就插入 defaultQuestions 裡所有物件
    const count = await Question.countDocuments();
    if (count === 0) {
      console.info('題庫為空，開始自動匯入預設題庫...');
      await Question.insertMany(defaultQuestions);
      console.info(`已匯入 ${defaultQuestions.length} 筆預設題庫`);
    }

    app.listen(PORT, () => console.log(`🚀 Server 跑在 http://localhost:${PORT}`));
  })
  .catch(err => console.error('❌ MongoDB 連線失敗：', err));