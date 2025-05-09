// models/LeaderboardEntry.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const leaderboardEntrySchema = new Schema({
  studentId: { type: String, required: true, unique: true },
  score:     { type: Number, required: true },
  level:     { type: Number, required: true }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('LeaderboardEntry', leaderboardEntrySchema);
