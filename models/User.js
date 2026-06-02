const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  googleUid: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  displayName: { type: String, default: '' },
  photoURL: { type: String, default: '' },
  studentId: { type: String, unique: true, sparse: true, trim: true },
  role: { type: String, enum: ['student', 'teacher'], default: 'student', index: true },
  lastLoginAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
