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
const admin = require('firebase-admin');

const defaultQuestions = require('./data/defaultQuestions');
const Question = require('./models/Question');
const QuestionBank = require('./models/QuestionBank');
const LeaderboardEntry = require('./models/LeaderboardEntry');
const User = require('./models/User');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGO_URI || '';
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, 'docs');
const uploadDir = path.join(__dirname, 'uploads');
const DEFAULT_TEACHER_EMAIL = 'cairo1680@apps.chses.tyc.edu.tw';
const TEACHER_EMAILS = new Set(
  [DEFAULT_TEACHER_EMAIL, ...(process.env.TEACHER_EMAILS || '').split(',')]
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
);
const FIREBASE_CLIENT_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBSisOANfkKW9AyCNGXX7zgzOKc1YjjziI',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'space-shooter-eb3f8.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'space-shooter-eb3f8',
  appId: process.env.FIREBASE_APP_ID || '1:657602014258:web:6a6c55bedcfd5b74d1602b'
};

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

let dbReady = false;
let firebaseReady = false;
let memoryQuestionBanks = [
  { _id: 'default', bankId: 'default', name: '預設題庫', isActive: true }
];
let memoryQuestions = defaultQuestions.map((q, i) => ({
  _id: `local-q-${i + 1}`,
  bankId: 'default',
  question: q.question,
  options: Array.isArray(q.options) ? q.options : [],
  answer: q.answer
}));
let memoryLeaderboard = [];
let memoryUsers = [];

try {
  if (admin.apps.length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      });
    } else if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    }
  }
  firebaseReady = admin.apps.length > 0;
} catch (err) {
  firebaseReady = false;
  console.warn('⚠️ Firebase Admin 初始化失敗，Google 登入驗證暫不可用：', err.message);
}

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
  res.json({ ok: true, dbReady, firebaseReady, mode: dbReady ? 'mongodb' : 'memory' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/firebase-config', (req, res) => {
  res.json({
    ...FIREBASE_CLIENT_CONFIG,
    configured: Object.values(FIREBASE_CLIENT_CONFIG).every(Boolean)
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.put('/api/auth/student-id', requireAuth, async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.body.studentId);

    if (!dbReady) {
      const duplicate = memoryUsers.find(item => item.studentId === studentId && item.googleUid !== req.user.googleUid);
      if (duplicate) return res.status(409).json({ message: '這個班級座號已經被其他 Google 帳號綁定' });
      req.user.studentId = studentId;
      return res.json({ user: publicUser(req.user) });
    }

    const duplicate = await User.findOne({ studentId, googleUid: { $ne: req.user.googleUid } }).lean();
    if (duplicate) return res.status(409).json({ message: '這個班級座號已經被其他 Google 帳號綁定' });

    const updated = await User.findOneAndUpdate(
      { googleUid: req.user.googleUid },
      { $set: { studentId } },
      { new: true, runValidators: true }
    ).lean();
    return res.json({ user: publicUser(updated) });
  } catch (err) {
    console.error('PUT /api/auth/student-id 錯誤:', err);
    return res.status(400).json({ message: err.message || '綁定班級座號失敗' });
  }
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

function normalizeCsvAnswer(rawAnswer, options) {
  const text = String(rawAnswer ?? '').trim();
  const numericAnswer = Number(text);
  if (Number.isInteger(numericAnswer) && numericAnswer >= 0 && numericAnswer <= 3) {
    return numericAnswer;
  }

  const matchedIndex = options.findIndex(option => option === text);
  if (matchedIndex >= 0) return matchedIndex;

  throw new Error(`answer 必須是 0 到 3，或填入正確選項文字。目前收到：${text || '空白'}`);
}

function normalizeBankName(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('題庫名稱不可空白');
  if (name.length > 40) throw new Error('題庫名稱最多 40 個字');
  return name;
}

function createBankId() {
  return `bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestedBankId(req) {
  return String(req.query.bankId || req.body.bankId || '').trim();
}

function getActiveMemoryBank() {
  return memoryQuestionBanks.find(bank => bank.isActive) || memoryQuestionBanks[0];
}

function getMemoryBankOrActive(req) {
  const bankId = getRequestedBankId(req);
  const bank = bankId
    ? memoryQuestionBanks.find(item => item.bankId === bankId)
    : getActiveMemoryBank();
  if (!bank) throw new Error('找不到指定題庫');
  return bank;
}

async function getDbBankOrActive(req) {
  const bankId = getRequestedBankId(req);
  const bank = bankId
    ? await QuestionBank.findOne({ bankId }).lean()
    : await QuestionBank.findOne({ isActive: true }).lean();
  if (!bank) throw new Error('找不到指定題庫');
  return bank;
}

function questionBankQuery(bankId) {
  if (bankId === 'default') {
    return { $or: [{ bankId }, { bankId: { $exists: false } }] };
  }
  return { bankId };
}

function sortLeaderboard(list) {
  return [...list].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.level !== a.level) return b.level - a.level;
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return 0;
  });
}

function isTeacherEmail(email) {
  return TEACHER_EMAILS.has(String(email || '').trim().toLowerCase());
}

function normalizeStudentId(value) {
  const studentId = String(value || '').trim();
  if (!/^\d{5}$/.test(studentId)) throw new Error('班級座號必須是 5 位數字');
  return studentId;
}

function publicUser(user) {
  if (!user) return null;
  return {
    googleUid: user.googleUid,
    email: user.email,
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    studentId: user.studentId || '',
    role: user.role || 'student',
    isTeacher: isTeacherEmail(user.email)
  };
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function syncUserFromToken(decoded) {
  const email = String(decoded.email || '').trim().toLowerCase();
  const data = {
    googleUid: decoded.uid,
    email,
    displayName: decoded.name || decoded.displayName || '',
    photoURL: decoded.picture || '',
    role: isTeacherEmail(email) ? 'teacher' : 'student',
    lastLoginAt: new Date()
  };

  if (!dbReady) {
    let user = memoryUsers.find(item => item.googleUid === decoded.uid);
    if (!user) {
      user = { _id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...data, studentId: '' };
      memoryUsers.push(user);
    } else {
      Object.assign(user, data);
    }
    return user;
  }

  return User.findOneAndUpdate(
    { googleUid: decoded.uid },
    { $set: data },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function requireAuth(req, res, next) {
  try {
    if (!firebaseReady) {
      return res.status(503).json({ message: 'Firebase Admin 尚未設定，無法驗證 Google 登入' });
    }
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ message: '請先使用 Google 登入' });

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email) return res.status(401).json({ message: 'Google 帳號缺少 email，無法登入' });
    req.user = await syncUserFromToken(decoded);
    req.firebaseUser = decoded;
    return next();
  } catch (err) {
    console.error('驗證登入失敗:', err);
    return res.status(401).json({ message: '登入驗證失敗，請重新登入' });
  }
}

function requireTeacher(req, res, next) {
  if (!req.user || !isTeacherEmail(req.user.email)) {
    return res.status(403).json({ message: '此功能僅限老師帳號使用' });
  }
  return next();
}

async function requireAuthTeacher(req, res, next) {
  return requireAuth(req, res, err => {
    if (err) return next(err);
    return requireTeacher(req, res, next);
  });
}

app.get('/api/question-banks', requireAuthTeacher, async (req, res) => {
  try {
    if (!dbReady) {
      return res.json(memoryQuestionBanks.map(bank => ({
        ...bank,
        count: memoryQuestions.filter(q => (q.bankId || 'default') === bank.bankId).length
      })));
    }

    const banks = await QuestionBank.find().sort({ createdAt: 1 }).lean();
    const counts = await Question.aggregate([
      { $group: { _id: { $ifNull: ['$bankId', 'default'] }, count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map(item => [item._id, item.count]));

    return res.json(banks.map(bank => ({
      _id: String(bank._id),
      bankId: bank.bankId,
      name: bank.name,
      isActive: bank.isActive,
      count: countMap.get(bank.bankId) || 0
    })));
  } catch (err) {
    console.error('GET /api/question-banks 錯誤:', err);
    return res.status(500).json({ message: '讀取題庫清單失敗', detail: err.message });
  }
});

app.post('/api/question-banks', requireAuthTeacher, async (req, res) => {
  try {
    const name = normalizeBankName(req.body);

    if (!dbReady) {
      const duplicate = memoryQuestionBanks.some(bank => bank.name === name);
      if (duplicate) return res.status(400).json({ message: '題庫名稱已存在' });
      const created = {
        _id: createBankId(),
        bankId: createBankId(),
        name,
        isActive: memoryQuestionBanks.length === 0
      };
      memoryQuestionBanks.push(created);
      return res.status(201).json({ ...created, count: 0 });
    }

    const duplicate = await QuestionBank.findOne({ name });
    if (duplicate) return res.status(400).json({ message: '題庫名稱已存在' });

    const created = await QuestionBank.create({
      bankId: createBankId(),
      name,
      isActive: (await QuestionBank.countDocuments()) === 0
    });

    return res.status(201).json({
      _id: String(created._id),
      bankId: created.bankId,
      name: created.name,
      isActive: created.isActive,
      count: 0
    });
  } catch (err) {
    console.error('POST /api/question-banks 錯誤:', err);
    return res.status(400).json({ message: err.message || '新增題庫失敗' });
  }
});

app.put('/api/question-banks/:bankId/active', requireAuthTeacher, async (req, res) => {
  try {
    if (!dbReady) {
      const target = memoryQuestionBanks.find(bank => bank.bankId === req.params.bankId);
      if (!target) return res.status(404).json({ message: '找不到指定題庫' });
      memoryQuestionBanks = memoryQuestionBanks.map(bank => ({
        ...bank,
        isActive: bank.bankId === req.params.bankId
      }));
      return res.json(memoryQuestionBanks.find(bank => bank.bankId === req.params.bankId));
    }

    const target = await QuestionBank.findOne({ bankId: req.params.bankId });
    if (!target) return res.status(404).json({ message: '找不到指定題庫' });
    await QuestionBank.updateMany({}, { isActive: false });
    target.isActive = true;
    await target.save();
    return res.json({
      _id: String(target._id),
      bankId: target.bankId,
      name: target.name,
      isActive: target.isActive
    });
  } catch (err) {
    console.error('PUT /api/question-banks/:bankId/active 錯誤:', err);
    return res.status(400).json({ message: err.message || '切換題庫失敗' });
  }
});

app.get('/api/questions', async (req, res) => {
  try {
    if (!dbReady) {
      const bank = getMemoryBankOrActive(req);
      return res.json(memoryQuestions.filter(q => (q.bankId || 'default') === bank.bankId));
    }
    const bank = await getDbBankOrActive(req);
    const qs = await Question.find(questionBankQuery(bank.bankId)).select('-__v').lean();
    return res.json(qs);
  } catch (err) {
    console.error('GET /api/questions 錯誤:', err);
    return res.json(memoryQuestions.filter(q => (q.bankId || 'default') === getActiveMemoryBank().bankId));
  }
});

app.post('/api/questions', requireAuthTeacher, async (req, res) => {
  try {
    const data = normalizeQuestionInput(req.body);
    const bank = dbReady ? await getDbBankOrActive(req) : getMemoryBankOrActive(req);
    if (!dbReady) {
      const created = { _id: `local-q-${Date.now()}`, bankId: bank.bankId, ...data };
      memoryQuestions.push(created);
      return res.status(201).json(created);
    }
    const created = await Question.create({ bankId: bank.bankId, ...data });
    return res.status(201).json(created);
  } catch (err) {
    console.error('POST /api/questions 錯誤:', err);
    return res.status(400).json({ message: err.message || '新增題目失敗' });
  }
});

app.put('/api/questions/:id', requireAuthTeacher, async (req, res) => {
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

app.delete('/api/questions/:id', requireAuthTeacher, async (req, res) => {
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

app.post('/api/questions/import', requireAuthTeacher, upload.single('file'), async (req, res) => {
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
        const bank = dbReady ? await getDbBankOrActive(req) : getMemoryBankOrActive(req);
        const parsedQuestions = rows.map((row, index) => {
          const question = String(row.question || '').trim();
          const option1 = String(row.option1 || '').trim();
          const option2 = String(row.option2 || '').trim();
          const option3 = String(row.option3 || '').trim();
          const option4 = String(row.option4 || '').trim();

          const options = row.options && String(row.options).trim()
            ? String(row.options).split(';').map(s => s.trim())
            : [option1, option2, option3, option4];

          const answer = normalizeCsvAnswer(row.answer, options);

          if (!question || options.length !== 4 || options.some(v => !v)) {
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
          memoryQuestions = memoryQuestions.filter(q => (q.bankId || 'default') !== bank.bankId);
          memoryQuestions = parsedQuestions.map((item, index) => ({
            _id: item._id || `local-q-import-${Date.now()}-${index + 1}`,
            bankId: bank.bankId,
            question: item.question,
            options: item.options,
            answer: item.answer
          })).concat(memoryQuestions);
          return res.json({ message: 'CSV 匯入完成（本機記憶體模式）', count: parsedQuestions.length });
        }

        await Question.deleteMany(questionBankQuery(bank.bankId));
        await Question.insertMany(parsedQuestions.map(({ question, options, answer }) => ({
          bankId: bank.bankId,
          question,
          options,
          answer
        })));
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

app.get('/api/questions/export', requireAuthTeacher, async (req, res) => {
  try {
    const bank = dbReady ? await getDbBankOrActive(req) : getMemoryBankOrActive(req);
    const source = dbReady
      ? await Question.find(questionBankQuery(bank.bankId)).lean()
      : memoryQuestions.filter(q => (q.bankId || 'default') === bank.bankId);

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
    res.attachment(`${bank.name}-questions.csv`);
    return res.send('\ufeff' + csv);
  } catch (err) {
    console.error('匯出 CSV 失敗:', err);
    return res.status(500).json({ message: '匯出失敗', detail: err.message });
  }
});

app.post('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const studentId = String(req.user.studentId || '').trim();
    const score = Number(req.body.score);
    const level = Number(req.body.level);

    if (!studentId) {
      return res.status(400).json({ message: '請先綁定班級座號' });
    }
    if (!Number.isFinite(score) || !Number.isFinite(level)) {
      return res.status(400).json({ message: '缺少 score 或 level' });
    }

    if (!dbReady) {
      const exist = memoryLeaderboard.find(item => item.googleUid === req.user.googleUid);
      if (exist) {
        if (score > exist.score || (score === exist.score && level > exist.level)) {
          exist.score = score;
          exist.level = level;
          exist.displayName = req.user.displayName || '';
          exist.email = req.user.email;
          exist.studentId = studentId;
          exist.updatedAt = new Date().toISOString();
        }
        return res.json({ entry: exist });
      }
      const created = {
        _id: `local-lb-${Date.now()}`,
        userId: req.user._id,
        googleUid: req.user.googleUid,
        email: req.user.email,
        displayName: req.user.displayName || '',
        studentId,
        score,
        level,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      memoryLeaderboard.push(created);
      return res.status(201).json({ entry: created });
    }

    const entryData = {
      userId: req.user._id,
      googleUid: req.user.googleUid,
      email: req.user.email,
      displayName: req.user.displayName || '',
      studentId
    };

    const exist = await LeaderboardEntry.findOne({ googleUid: req.user.googleUid });
    if (exist) {
      Object.assign(exist, entryData);
      if (score > exist.score || (score === exist.score && level > exist.level)) {
        exist.score = score;
        exist.level = level;
      }
      await exist.save();
      return res.json({ entry: exist });
    }

    const created = await LeaderboardEntry.create({ ...entryData, score, level });
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

app.delete('/api/leaderboard', requireAuthTeacher, async (req, res) => {
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

app.delete('/api/leaderboard/:id', requireAuthTeacher, async (req, res) => {
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

    let defaultBank = await QuestionBank.findOne({ bankId: 'default' });
    if (!defaultBank) {
      defaultBank = await QuestionBank.create({
        bankId: 'default',
        name: '預設題庫',
        isActive: true
      });
      console.log('✅ 已建立預設題庫套組');
    }

    await Question.updateMany(
      { bankId: { $exists: false } },
      { $set: { bankId: 'default' } }
    );

    const activeBank = await QuestionBank.findOne({ isActive: true });
    if (!activeBank) {
      defaultBank.isActive = true;
      await defaultBank.save();
    }

    const count = await Question.countDocuments();
    if (count === 0) {
      await Question.insertMany(defaultQuestions.map(q => ({ bankId: 'default', ...q })));
      console.log(`✅ 已匯入 ${defaultQuestions.length} 筆預設題庫`);
    }
  } catch (err) {
    dbReady = false;
    console.error('❌ MongoDB 連線失敗，改用本機記憶體模式：', err.message);
  }
})();
