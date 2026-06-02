// models/LeaderboardEntry.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leaderboardEntrySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  googleUid: { type: String, unique: true, sparse: true, index: true },
  email: { type: String, lowercase: true, trim: true, default: '' },
  displayName: { type: String, default: '' },
  studentId: { type: String, required: true, unique: true, index: true },
  score: { type: Number, required: true },
  level: { type: Number, required: true }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('LeaderboardEntry', leaderboardEntrySchema);
