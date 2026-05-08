const mongoose = require('mongoose');
const { Schema } = mongoose;

const QuestionBankSchema = new Schema({
  bankId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  isActive: { type: Boolean, required: true, default: false }
}, { timestamps: true });

module.exports = mongoose.model('QuestionBank', QuestionBankSchema);
