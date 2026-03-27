const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config();
} catch (err) {
  console.warn('⚠️ dotenv 載入失敗，略過 .env');
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const csvParser = require('csv-parser');
const { Parser } = require('json2csv');

const defaultQuestions = require('./data/defaultQuestions');
const Question = require('./models/Question');
const LeaderboardEntry = require('./models/LeaderboardEntry');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGO_URI || '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

let dbReady = false;
let memoryQuestions = defaultQuestions.map((q, i) => ({
  _id: `local-q-${i + 1}`,
  question: q.question,
  options: Array.isArray(q.options) ? q.options : [],
  answer: q.answer
}));
let memoryLeaderboard = [];

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://localhost:5501',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:5501',
  'https://chses1.github.io',
  'https://space-shooter2-mdyh.onrender.com'
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, true);
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

app.get('/health', (req, res) => {
  res.json({ ok: true, dbReady, mode: dbReady ? 'mongodb' : 'memory' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function normalizeQuestionInput(body) {
  const question = String(body.question || '').trim();
  const options = Array.isArray(body.options)
    ? body.options.map(v => String(v ?? '').trim())
    : [];
  const answer = Number(body.answer);

  if (!question) throw new Error('題目不可空白');
  if (options.length !== 4 || options.some(v => !v)) throw new Error('選項必須剛好 4 個且不可空白');
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error('答案必須是 0 到 3');

  return { question, options, answer };
}

function sortLeaderboard(list) {
  return [...list].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.level !== a.level) return b.level - a.level;
    return 0;
  });
}

app.get('/api/questions', async (req, res) => {
  try {
    if (!dbReady) return res.json(memoryQuestions);
    const qs = await Question.find().select('-__v').lean();
    return res.json(qs);
  } catch (err) {
    console.error('GET /api/questions 錯誤:', err);
    return res.json(memoryQuestions);
  }
});

app.post('/api/questions', async (req, res) => {
  try {
    const data = normalizeQuestionInput(req.body);
    if (!dbReady) {
      const created = { _id: `local-q-${Date.now()}`, ...data };
      memoryQuestions.push(created);
      return res.status(201).json(created);
    }
    const created = await Question.create(data);
    return res.status(201).json(created);
  } catch (err) {
    console.error('POST /api/questions 錯誤:', err);
    return res.status(400).json({ message: err.message || '新增題目失敗' });
  }
});

app.put('/api/questions/:id', async (req, res) => {
  try {
    const data = normalizeQuestionInput(req.body);
    if (!dbReady) {
      const idx = memoryQuestions.findIndex(q => q._id === req.params.id);
      if (idx === -1) return res.status(404).json({ message: '找不到該題目' });
      memoryQuestions[idx] = { ...memoryQuestions[idx], ...data };
      return res.json(memoryQuestions[idx]);
    }
    const updated = await Question.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: '找不到該題目' });
    return res.json(updated);
  } catch (err) {
    console.error('PUT /api/questions/:id 錯誤:', err);
    return res.status(400).json({ message: err.message || '更新題目失敗' });
  }
});

app.delete('/api/questions/:id', async (req, res) => {
  try {
    if (!dbReady) {
      const before = memoryQuestions.length;
      memoryQuestions = memoryQuestions.filter(q => q._id !== req.params.id);
      if (memoryQuestions.length === before) return res.status(404).json({ message: '找不到該題目' });
      return res.json({ message: '已刪除題目' });
    }
    const deleted = await Question.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: '找不到該題目' });
    return res.json({ message: '已刪除題目' });
  } catch (err) {
    console.error('DELETE /api/questions/:id 錯誤:', err);
    return res.status(500).json({ message: err.message || '刪除題目失敗' });
  }
});

app.post('/api/questions/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '沒有收到上傳檔案' });

  const rows = [];
  fs.createReadStream(req.file.path)
    .pipe(csvParser({ skipLines: 0 }))
    .on('data', row => rows.push(row))
    .on('end', async () => {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}

      try {
        const parsedQuestions = rows.map((row, index) => {
          const question = String(row.question || '').trim();
          const option1 = String(row.option1 || '').trim();
          const option2 = String(row.option2 || '').trim();
          const option3 = String(row.option3 || '').trim();
          const option4 = String(row.option4 || '').trim();

          const options = row.options && String(row.options).trim()
            ? String(row.options).split(';').map(s => s.trim())
            : [option1, option2, option3, option4];

          const answer = Number(row.answer);

          if (!question || options.length !== 4 || options.some(v => !v) || !Number.isInteger(answer) || answer < 0 || answer > 3) {
            throw new Error(`第 ${index + 1} 筆 CSV 格式錯誤，請確認 question / option1~4 / answer`);
          }

          return {
            _id: row._id ? String(row._id).trim() : '',
            question,
            options,
            answer
          };
        });

        if (!dbReady) {
          memoryQuestions = parsedQuestions.map((item, index) => ({
            _id: item._id || `local-q-import-${Date.now()}-${index + 1}`,
            question: item.question,
            options: item.options,
            answer: item.answer
          }));
          return res.json({ message: 'CSV 匯入完成（本機記憶體模式）', count: parsedQuestions.length });
        }

        await Question.deleteMany({});
        await Question.insertMany(parsedQuestions.map(({ question, options, answer }) => ({ question, options, answer })));
        return res.json({ message: 'CSV 匯入完成', count: parsedQuestions.length });
      } catch (err) {
        console.error('CSV 匯入失敗:', err);
        return res.status(400).json({ message: 'CSV 匯入失敗', detail: err.message });
      }
    })
    .on('error', err => {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
      console.error('CSV 解析失敗:', err);
      return res.status(400).json({ message: 'CSV 解析失敗', detail: err.message });
    });
});

app.get('/api/questions/export', async (req, res) => {
  try {
    const source = dbReady ? await Question.find().lean() : memoryQuestions;

    const data = source.map(q => ({
      _id: String(q._id),
      question: q.question,
      option1: q.options?.[0] || '',
      option2: q.options?.[1] || '',
      option3: q.options?.[2] || '',
      option4: q.options?.[3] || '',
      answer: q.answer
    }));

    const parser = new Parser({ fields: ['_id', 'question', 'option1', 'option2', 'option3', 'option4', 'answer'] });
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('questions.csv');
    return res.send('\ufeff' + csv);
  } catch (err) {
    console.error('匯出 CSV 失敗:', err);
    return res.status(500).json({ message: '匯出失敗', detail: err.message });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  try {
    const studentId = String(req.body.studentId || '').trim();
    const score = Number(req.body.score);
    const level = Number(req.body.level);

    if (!studentId || !Number.isFinite(score) || !Number.isFinite(level)) {
      return res.status(400).json({ message: '缺少 studentId、score 或 level' });
    }

    if (!dbReady) {
      const exist = memoryLeaderboard.find(item => item.studentId === studentId);
      if (exist) {
        if (score > exist.score || (score === exist.score && level > exist.level)) {
          exist.score = score;
          exist.level = level;
          exist.updatedAt = new Date().toISOString();
        }
        return res.json({ entry: exist });
      }
      const created = {
        _id: `local-lb-${Date.now()}`,
        studentId,
        score,
        level,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      memoryLeaderboard.push(created);
      return res.status(201).json({ entry: created });
    }

    const exist = await LeaderboardEntry.findOne({ studentId });
    if (exist) {
      if (score > exist.score || (score === exist.score && level > exist.level)) {
        exist.score = score;
        exist.level = level;
        await exist.save();
      }
      return res.json({ entry: exist });
    }

    const created = await LeaderboardEntry.create({ studentId, score, level });
    return res.status(201).json({ entry: created });
  } catch (err) {
    console.error('POST /api/leaderboard 錯誤:', err);
    return res.status(500).json({ message: '排行榜寫入失敗', detail: err.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit) || 10);
    if (!dbReady) {
      return res.json(sortLeaderboard(memoryLeaderboard).slice(0, limit));
    }
    const list = await LeaderboardEntry.find().sort({ score: -1, level: -1, updatedAt: 1 }).limit(limit).select('-__v').lean();
    return res.json(list);
  } catch (err) {
    console.error('GET /api/leaderboard 錯誤:', err);
    return res.status(500).json({ message: '讀取排行榜失敗', detail: err.message });
  }
});

app.delete('/api/leaderboard', async (req, res) => {
  try {
    if (!dbReady) {
      memoryLeaderboard = [];
      return res.json({ message: '✅ 已清除所有排行榜資料（本機記憶體模式）' });
    }
    await LeaderboardEntry.deleteMany({});
    return res.json({ message: '✅ 已清除所有排行榜資料' });
  } catch (err) {
    console.error('DELETE /api/leaderboard 錯誤:', err);
    return res.status(500).json({ message: '清除排行榜失敗', detail: err.message });
  }
});

app.delete('/api/leaderboard/:id', async (req, res) => {
  try {
    if (!dbReady) {
      const before = memoryLeaderboard.length;
      memoryLeaderboard = memoryLeaderboard.filter(item => item._id !== req.params.id);
      if (memoryLeaderboard.length === before) return res.status(404).json({ message: '找不到該筆排行榜資料' });
      return res.sendStatus(204);
    }
    const deleted = await LeaderboardEntry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: '找不到該筆排行榜資料' });
    return res.sendStatus(204);
  } catch (err) {
    console.error('DELETE /api/leaderboard/:id 錯誤:', err);
    return res.status(500).json({ message: '刪除排行榜失敗', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server 跑在 http://localhost:${PORT}`);
});

(async () => {
  if (!MONGO_URI) {
    console.warn('⚠️ 未設定 MONGO_URI，改用本機記憶體模式執行');
    dbReady = false;
    return;
  }

  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    dbReady = true;
    console.log('✅ MongoDB 已連線');

    const count = await Question.countDocuments();
    if (count === 0) {
      await Question.insertMany(defaultQuestions);
      console.log(`✅ 已匯入 ${defaultQuestions.length} 筆預設題庫`);
    }
  } catch (err) {
    dbReady = false;
    console.error('❌ MongoDB 連線失敗，改用本機記憶體模式：', err.message);
  }
})();
