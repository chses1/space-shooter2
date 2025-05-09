// models/Question.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const QuestionSchema = new Schema({
  question: { type: String, required: true },
  options:  { type: [String], required: true },
  answer:   { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Question', QuestionSchema);