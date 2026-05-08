// models/Question.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const QuestionSchema = new Schema({
  bankId:   { type: String, required: true, default: 'default', index: true },
  question: { type: String, required: true },
  options:  { type: [String], required: true },
  answer:   { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Question', QuestionSchema);
