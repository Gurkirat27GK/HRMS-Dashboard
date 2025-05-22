const mongoose = require('mongoose');

const CandidateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },
  position: {
    type: String,
    required: true
  },
  experience: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['applied', 'interviewing', 'selected', 'rejected'],
    default: 'applied'
  },
  resume: {
    type: String, // URL to resume file
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Candidate', CandidateSchema);